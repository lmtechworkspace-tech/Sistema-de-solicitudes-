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

// v13 (Fase 4, "centro documental"): categorías fijas -- un enum chico y
// genérico (a diferencia del `tipo` de SGC, que sigue una taxonomía ISO) que
// cubre lo que de verdad varía entre documentos de un proyecto interno.
var PROYECTO_DOC_CATEGORIAS_ = ['REQUISITOS', 'DISEÑO', 'CONTRATO', 'ACTA', 'APROBACION', 'ENTREGABLE', 'OTRO'];
var PROYECTO_DOC_CATEGORIA_ETIQUETA_ = {
  REQUISITOS: 'Requisitos', DISEÑO: 'Diseño', CONTRATO: 'Contrato',
  ACTA: 'Acta', APROBACION: 'Aprobación', ENTREGABLE: 'Entregable', OTRO: 'Otro'
};

// Subcarpeta propia dentro de la carpeta del proyecto (que ya existe para
// los adjuntos de la Sala) -- separa el repositorio formal de los archivos
// sueltos de conversación sin crear una raíz de Drive nueva.
function obtenerCarpetaDocumentosProyecto_(proyecto) {
  return obtenerOCrearSubcarpeta_(obtenerCarpetaProyecto_(proyecto), 'Documentos');
}

function buscarDocumentoProyecto_(documentoId) {
  return leerFilasSeguro_(SHEETS.PROYECTO_DOCUMENTOS).filter(function (d) { return d.documento_id === documentoId; })[0];
}

function buscarReunionProyecto_(reunionId) {
  return leerFilasSeguro_(SHEETS.PROYECTO_REUNIONES).filter(function (r) { return r.reunion_id === reunionId; })[0];
}

function buscarDecisionProyecto_(decisionId) {
  return leerFilasSeguro_(SHEETS.PROYECTO_DECISIONES).filter(function (d) { return d.decision_id === decisionId; })[0];
}

// Valida y sube el binario a Drive -- MISMA validación que subirAdjunto
// (tamaño, firma binaria real, nunca la extensión ni el mime del navegador),
// reusada aquí para no duplicar la regla de seguridad en dos lugares.
function subirArchivoDocumentoProyecto_(data, proyecto) {
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
  var mime = mimeArchivoSgc_(bytes, data.nombre_archivo) || detectarMimeImagenProyecto_(bytes);
  if (!mime) {
    return errorValidacion_('contenido_base64', 'Formato no admitido. Se aceptan PDF, Word, Excel, PowerPoint, JPG, PNG o WebP.');
  }
  var carpeta = obtenerCarpetaDocumentosProyecto_(proyecto);
  var archivoDrive = carpeta.createFile(Utilities.newBlob(bytes, mime, data.nombre_archivo));
  return { archivo_id: archivoDrive.getId(), archivo_nombre: data.nombre_archivo, archivo_mime: mime, tamano_bytes: bytes.length };
}

// vN autoincremental por documento -- un documento de proyecto no necesita
// el código de versión formal que SGC exige para auditoría externa (v01,
// v02...); alcanza con un entero simple que nunca colisiona.
function siguienteVersionDocumentoProyecto_(documentoId) {
  var max = 0;
  leerFilasSeguro_(SHEETS.PROYECTO_DOC_VERSIONES).forEach(function (v) {
    if (v.documento_id !== documentoId) return;
    var n = Number(String(v.version || '').replace(/[^0-9]/g, ''));
    if (n > max) max = n;
  });
  return 'v' + (max + 1);
}

// Registra la nueva versión (append-only, nunca se borra) y sincroniza la
// copia denormalizada en PROYECTO_DOCUMENTOS -- mismo patrón que
// registrarVersionSgc_/nuevaVersion en Calidad.gs.
function registrarVersionDocumentoProyecto_(documentoId, version, comentario, archivo, contexto) {
  leerFilasSeguro_(SHEETS.PROYECTO_DOC_VERSIONES).forEach(function (v) {
    if (v.documento_id === documentoId && esVerdaderoProyecto_(v.vigente)) {
      actualizarFilaPorId_(SHEETS.PROYECTO_DOC_VERSIONES, 'version_id', v.version_id, { vigente: false });
    }
  });
  var fila = {
    version_id: Utilities.getUuid(), documento_id: documentoId, version: version,
    comentario: comentario || '', archivo_id: archivo.archivo_id, archivo_nombre: archivo.archivo_nombre,
    archivo_mime: archivo.archivo_mime, tamano_bytes: archivo.tamano_bytes || 0,
    subido_por: (contexto && contexto.email) || '', fecha: new Date().toISOString(), vigente: true
  };
  agregarFila_(SHEETS.PROYECTO_DOC_VERSIONES, fila);
  actualizarFilaPorId_(SHEETS.PROYECTO_DOCUMENTOS, 'documento_id', documentoId, {
    version_vigente: version, archivo_id: archivo.archivo_id, archivo_nombre: archivo.archivo_nombre,
    archivo_mime: archivo.archivo_mime, tamano_bytes: archivo.tamano_bytes || 0
  });
  return fila;
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
        salud_motivos: salud.motivos,
        salud_score: salud.score,
        salud_penalizacion: salud.penalizacion
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
    // v10 (multi-asignación): "mi trabajo" incluye las tareas donde soy
    // colaborador, no solo donde soy el responsable.
    function esMiaOColaboroYVisible(a) {
      if (!(esAdmGerencia || misProyectos[a.proyecto_id])) return false;
      return trabajaLaActividad_(a, email);
    }

    var tareas = leerFilasSeguro_(SHEETS.ACTIVIDADES).filter(function (a) {
      var activa = a.activa === true || a.activa === 'TRUE' || a.activa === 1;
      return activa && a.proyecto_id && esMiaOColaboroYVisible(a);
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
        meta_cantidad: a.meta_cantidad, meta_unidad: a.meta_unidad,
        // v10 (multi-asignación): si aparezco por colaborador y no por dueño,
        // el frontend lo marca ("Colaboras") en vez de mostrarme como titular.
        soy_responsable: normalizarEmailProyecto_(a.responsable_email) === email
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
    // v13 (Fase 4, "centro documental"): metadata liviana (nunca el binario)
    // -- se puede cargar junto con el resto del detalle sin costo real. Solo
    // los activos (activo=true); "eliminar" es soft-delete, igual criterio
    // que el resto del módulo.
    var documentos = leerFilasSeguro_(SHEETS.PROYECTO_DOCUMENTOS)
      .filter(function (d) { return d.proyecto_id === proyecto.proyecto_id && esVerdaderoProyecto_(d.activo); })
      .sort(function (a, b) { return new Date(b.fecha_creacion) - new Date(a.fecha_creacion); });
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
      documentos: documentos,
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
      salud_score: salud.score,
      salud_penalizacion: salud.penalizacion,
      salud_desglose: salud.desglose,
      requiere_atencion: calcularRequiereAtencion_(tareas, hitos, integrantes, riesgos),
      // v13 (Fase 2, "dashboard ejecutivo"): avance ESPERADO a hoy y su
      // desviación -- mismo supuesto lineal, documentado y ya probado, que
      // usa Plan/Esperado/Real POR TAREA (P1); aquí se aplica una sola vez a
      // nivel de PROYECTO completo (fecha_inicio->fecha_objetivo), sin pedir
      // bitácora (que solo carga la pestaña Cronograma, lazy). Null si faltan
      // fechas -- nunca un 0% inventado.
      avance_esperado_pct: calcularAvanceEsperado_(proyecto.fecha_inicio, proyecto.fecha_objetivo, new Date()),
      // v10 (Fase D, propuesta 09 "resumen diario"): "que se movio" desde la
      // ULTIMA VEZ que ESTA persona vio la Sala -- null si nunca la visito
      // (primera vez: no hay "desde" que mostrar, seria ruido).
      resumen_desde_ultima_visita: calcularResumenVisitaProyecto_(proyecto, contexto, integrantes, tareas),
      // v10 (auditoría G, carta de dedicación pro): los feriados (org-wide,
      // CONFIG_FERIADOS) para que la Carta de Dedicación los sombree y no los
      // cuente como "vencida sin gestión" ni como día laboral. Array de
      // 'YYYY-MM-DD'. Si la hoja no existe, obtenerFeriados_ devuelve [].
      feriados: obtenerFeriados_()
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
    var errFechas = errorFechasProyecto_(data.fecha_inicio, data.fecha_objetivo);
    if (errFechas) return errFechas;

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

    // Se valida la combinacion que QUEDA, no el campo que llego: se puede
    // mover una sola de las dos fechas y romper el orden contra la otra.
    var errFechasAct = errorFechasProyecto_(
      data.fecha_inicio !== undefined ? data.fecha_inicio : proyecto.fecha_inicio,
      data.fecha_objetivo !== undefined ? data.fecha_objetivo : proyecto.fecha_objetivo
    );
    if (errFechasAct) return errFechasAct;

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
    // v11 (P2, "subtareas con rollup"): un solo nivel -- el padre debe ser
    // del mismo proyecto y NO puede ser a su vez una subtarea (evita anidar
    // subtareas de subtareas, que complicaría el rollup sin aportar control
    // real). El rollup de avance se calcula on-read en listarTareas.
    if (data.tarea_padre_id) {
      var padre = leerFilasSeguro_(SHEETS.ACTIVIDADES).filter(function (a) { return a.actividad_id === data.tarea_padre_id; })[0];
      if (!padre || padre.proyecto_id !== proyecto.proyecto_id) {
        return errorValidacion_('tarea_padre_id', 'La tarea padre debe ser del mismo proyecto.');
      }
      if (padre.tarea_padre_id) {
        return errorValidacion_('tarea_padre_id', 'Esa tarea ya es una subtarea -- no se puede anidar un tercer nivel.');
      }
    }
    var enriquecido = {};
    for (var k in data) enriquecido[k] = data[k];
    enriquecido.proyecto = proyecto.nombre; // compat: campo de texto libre ya existente en ACTIVIDADES
    enriquecido.proyecto_id = proyecto.proyecto_id;
    // v10 (multi-asignación): los colaboradores de una tarea de proyecto
    // deben ser INTEGRANTES del proyecto (mismo círculo que el responsable,
    // RN-709). El frontend solo ofrece integrantes; esto descarta cualquier
    // correo ajeno que se cuele -- no otorga check-in a gente de afuera.
    if (data.colaboradores_emails) {
      var miembros = {};
      leerFilasSeguro_(SHEETS.PROYECTO_INTEGRANTES).forEach(function (i) {
        if (i.proyecto_id === proyecto.proyecto_id && esVerdaderoProyecto_(i.activo)) {
          miembros[normalizarEmailProyecto_(i.usuario_email)] = true;
        }
      });
      var lista = data.colaboradores_emails;
      if (typeof lista === 'string') { try { lista = JSON.parse(lista); } catch (e) { lista = []; } }
      enriquecido.colaboradores_emails = (Array.isArray(lista) ? lista : []).filter(function (correo) {
        return miembros[normalizarEmailProyecto_(correo)];
      });
    }
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

  editarTarea: function (data, contexto) {
    var proyecto = buscarProyecto_(data.proyecto_id);
    if (!proyecto) return errorValidacion_('proyecto_id', 'Proyecto no encontrado.');
    if (!data.actividad_id) return errorValidacion_('actividad_id', 'Falta indicar la tarea.');
    var actividad = leerFilasSeguro_(SHEETS.ACTIVIDADES).filter(function (a) {
      return a.actividad_id === data.actividad_id && a.proyecto_id === proyecto.proyecto_id;
    })[0];
    if (!actividad) return errorValidacion_('actividad_id', 'Tarea no encontrada en este proyecto.');
    var esGestor = puedeGestionarProyecto_(proyecto, contexto);
    var esTrabajador = trabajaLaActividad_(actividad, contexto.email);
    if (!esGestor && !esTrabajador) {
      return { _forbidden: true, message: 'Solo el líder, un administrador, o quien trabaja la tarea pueden editarla.' };
    }
    if (data.hito_id) {
      var hito = leerFilasSeguro_(SHEETS.PROYECTO_HITOS).filter(function (h) { return h.hito_id === data.hito_id; })[0];
      if (!hito || hito.proyecto_id !== proyecto.proyecto_id) {
        return errorValidacion_('hito_id', 'El hito no pertenece a este proyecto.');
      }
    }
    if (data.depende_de) {
      var dependencia = leerFilasSeguro_(SHEETS.ACTIVIDADES).filter(function (a) { return a.actividad_id === data.depende_de; })[0];
      if (!dependencia || dependencia.proyecto_id !== proyecto.proyecto_id) {
        return errorValidacion_('depende_de', 'La tarea de la que depende debe ser del mismo proyecto.');
      }
    }
    if (data.tarea_padre_id) {
      var padre = leerFilasSeguro_(SHEETS.ACTIVIDADES).filter(function (a) { return a.actividad_id === data.tarea_padre_id; })[0];
      if (!padre || padre.proyecto_id !== proyecto.proyecto_id) {
        return errorValidacion_('tarea_padre_id', 'La tarea padre debe ser del mismo proyecto.');
      }
      if (padre.tarea_padre_id) {
        return errorValidacion_('tarea_padre_id', 'Esa tarea ya es una subtarea -- no se puede anidar un tercer nivel.');
      }
      if (data.tarea_padre_id === data.actividad_id) {
        return errorValidacion_('tarea_padre_id', 'Una tarea no puede ser padre de sí misma.');
      }
    }
    var cambios = {};
    var camposPermitidos = ['titulo', 'descripcion', 'responsable_email', 'fecha_compromiso', 'prioridad', 'hito_id', 'depende_de', 'tarea_padre_id', 'meta_cantidad', 'meta_unidad'];
    camposPermitidos.forEach(function (campo) {
      if (data[campo] !== undefined) cambios[campo] = data[campo];
    });
    if (data.colaboradores_emails !== undefined) {
      var miembros = {};
      leerFilasSeguro_(SHEETS.PROYECTO_INTEGRANTES).forEach(function (i) {
        if (i.proyecto_id === proyecto.proyecto_id && esVerdaderoProyecto_(i.activo)) {
          miembros[normalizarEmailProyecto_(i.usuario_email)] = true;
        }
      });
      var lista = data.colaboradores_emails;
      if (typeof lista === 'string') { try { lista = JSON.parse(lista); } catch (e) { lista = []; } }
      var responsable = normalizarEmailProyecto_(data.responsable_email || actividad.responsable_email);
      cambios.colaboradores_emails = JSON.stringify(
        (Array.isArray(lista) ? lista : []).filter(function (correo) {
          return miembros[normalizarEmailProyecto_(correo)] && normalizarEmailProyecto_(correo) !== responsable;
        })
      );
    }
    if (data.responsable_email && data.responsable_email !== actividad.responsable_email) {
      var integrantes = leerFilasSeguro_(SHEETS.PROYECTO_INTEGRANTES);
      var nuevoResp = integrantes.filter(function (i) {
        return i.proyecto_id === proyecto.proyecto_id && normalizarEmailProyecto_(i.usuario_email) === normalizarEmailProyecto_(data.responsable_email);
      })[0];
      if (nuevoResp) cambios.responsable_nombre = nuevoResp.usuario_nombre || '';
    }
    cambios.ultima_actualizacion = new Date().toISOString();
    var actualizado = reescribirActividad_(actividad.actividad_id, cambios);
    registrarEventoProyecto_(proyecto.proyecto_id, 'ACTUALIZACION', contexto,
      'Tarea editada: ' + (cambios.titulo || actividad.titulo), 'ACTIVIDAD', actividad.actividad_id, '');
    return actualizado;
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
    // v10 (multi-asignación): nombres del equipo para mostrar colaboradores
    // como nombre (no correo crudo) en las tarjetas.
    var nombrePorEmail = {};
    leerFilasSeguro_(SHEETS.PROYECTO_INTEGRANTES).forEach(function (i) {
      if (i.proyecto_id === proyecto.proyecto_id) nombrePorEmail[normalizarEmailProyecto_(i.usuario_email)] = i.usuario_nombre || i.usuario_email;
    });
    // v11 (P2, "dependencias con impacto"): quién depende de quién, en un
    // solo mapa reusado por calcularImpactoDependencia_ para cada tarea (en
    // vez de reconstruirlo N veces dentro del .map de abajo).
    var dependientesDirectosPorId_ = {};
    tareas.forEach(function (a) { if (a.depende_de) (dependientesDirectosPorId_[a.depende_de] = dependientesDirectosPorId_[a.depende_de] || []).push(a); });
    // v11 (P2, "subtareas con rollup"): hijas por padre, para calcular el
    // avance del padre on-read (nunca se guarda -- así nunca desincroniza).
    var hijasPorPadre_ = {};
    tareas.forEach(function (a) { if (a.tarea_padre_id) (hijasPorPadre_[a.tarea_padre_id] = hijasPorPadre_[a.tarea_padre_id] || []).push(a); });

    // v13 (Fase 1, "ruta crítica"): CPM sobre la red de dependencias, UNA vez
    // para todo el proyecto (mismo patrón que el impacto de retraso).
    var rutaCritica_ = calcularRutaCritica_(tareas);

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
      // v11 (P2): "si esto se atrasa, ¿a qué más afecta?" -- tareas activas
      // que dependen de esta, directa o transitivamente. Puramente
      // informativo, igual criterio que dependencia_comprometida arriba.
      var dependientes = calcularImpactoDependencia_(a.actividad_id, dependientesDirectosPorId_);
      a.impacto_dependientes = dependientes.length;
      a.impacto_titulos = dependientes.slice(0, 3).map(function (d) { return d.titulo; });
      // v13 (Fase 1, "ruta crítica"): ¿está esta tarea en la cadena que
      // determina la duración del proyecto? Holgura en días (null si la tarea
      // no participa de ninguna dependencia).
      var rc_ = rutaCritica_.porTarea[a.actividad_id];
      a.es_critica = !!(rc_ && rc_.es_critica);
      a.holgura_dias = rc_ ? rc_.holgura_dias : null;
      // v10 (multi-asignación): la lista de colaboradores ya parseada y con
      // nombre resuelto -- el frontend no toca JSON ni resuelve correos.
      a.colaboradores = colaboradoresDeActividad_(a).map(function (email) {
        return { email: email, nombre: nombrePorEmail[email] || email };
      });
      // v11 (P2, "subtareas con rollup"): sin hijas, una tarea se comporta
      // exactamente igual que antes (solo su propio avance_pct). Con hijas,
      // se agrega el resumen -- el promedio usa avanceRealTarea_ (P1, mismo
      // criterio que Plan/Esperado/Real: avance_pct si existe, 100/0 en
      // TERMINADA/NO_INICIADA, nunca inventado para el resto).
      var hijas = hijasPorPadre_[a.actividad_id] || [];
      if (hijas.length) {
        a.subtareas_total = hijas.length;
        a.subtareas_terminadas = hijas.filter(function (h) { return h.estado === 'TERMINADA'; }).length;
        var suma = hijas.reduce(function (s, h) { return s + (avanceRealTarea_(h) || 0); }, 0);
        a.avance_rollup_pct = Math.round((suma / hijas.length) * 10) / 10;
      }
      a.es_subtarea = !!a.tarea_padre_id;
      if (a.es_subtarea && porId[a.tarea_padre_id]) a.padre_titulo = porId[a.tarea_padre_id].titulo;
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
      .map(filaBitacoraSalida_)
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
      // v10 (multi-asignación): mi dedicación incluye tareas donde soy
      // responsable O colaborador.
      if (!trabajaLaActividad_(a, email)) return;
      if (!esAdmGerencia && !misProyectos[a.proyecto_id]) return;
      idsTarea[a.actividad_id] = true;
    });
    return leerFilasSeguro_(SHEETS.ACTIVIDADES_BITACORA)
      .filter(function (b) { return idsTarea[b.actividad_id]; })
      .map(filaBitacoraSalida_)
      .sort(function (a, b) { return new Date(a.timestamp) - new Date(b.timestamp); });
  },

  // v11 (Reingeniería Cronograma, P0): guarda/edita el REGISTRO DEL DÍA de
  // una tarea -- la celda diaria de la Carta Gantt convertida en unidad de
  // información editable. Es el corazón de la reingeniería: cada celda deja
  // de ser una lectura derivada del check-in y pasa a tener su propio
  // estado-del-día explícito, horas, comentario, tramos y motivo de bloqueo.
  //
  // Diseño clave (por qué NO agrega columnas ni necesita Instalador): el
  // registro vive como un 'tipo' nuevo (REGISTRO_DIA) dentro de la MISMA
  // ACTIVIDADES_BITACORA, reusando el JSON libre 'datos' igual que ya hacen
  // horas/avance/confianza. Es UPSERT: una sola fila por (tarea, día); al
  // re-guardar se conserva la versión anterior en datos.ediciones (historial
  // antes→después) y se sella editado_por/editado_en -- append-only real, la
  // fila no se pierde, solo se versiona.
  //
  // Permiso: ver el proyecto Y (trabajar la tarea O poder gestionar el
  // proyecto). Reusa los gates existentes -- cero sistema de usuarios nuevo.
  //
  // SIGSO no es vigilancia: esto registra el COMPROMISO y el RESULTADO del
  // día (qué se hizo, en qué estado quedó), no controla personas. "Sin
  // registro" nunca se guarda como estado -- simplemente no hay fila.
  guardarRegistroDia: function (data, contexto) {
    data = data || {};
    var proyecto = buscarProyecto_(data.proyecto_id);
    if (!proyecto) return errorValidacion_('proyecto_id', 'Proyecto no encontrado.');
    if (!puedeVerProyecto_(proyecto, contexto)) {
      return { _forbidden: true, message: 'No tienes acceso a este proyecto.' };
    }

    var actividad = leerFilasSeguro_(SHEETS.ACTIVIDADES).filter(function (a) {
      return a.actividad_id === data.actividad_id && a.proyecto_id === proyecto.proyecto_id;
    })[0];
    if (!actividad) return errorValidacion_('actividad_id', 'Tarea no encontrada en este proyecto.');

    var email = normalizarEmailProyecto_(contexto && contexto.email);
    if (!trabajaLaActividad_(actividad, email) && !puedeGestionarProyecto_(proyecto, contexto)) {
      return { _forbidden: true, message: 'Solo quien trabaja la tarea o el líder del proyecto puede registrar el día.' };
    }

    // Día: 'YYYY-MM-DD'. Validación de forma + que no sea futuro (no se
    // registra un día que todavía no ocurrió; "planificado" a futuro se
    // maneja con el plan de la tarea, no con el registro del día).
    var dia = String(data.dia || '').trim();
    if (!/^\d{4}-\d{2}-\d{2}$/.test(dia)) {
      return errorValidacion_('dia', 'El día debe tener formato AAAA-MM-DD.');
    }
    var hoyClave = claveDia_(new Date(), 'America/Santiago');
    if (dia > hoyClave) {
      return errorValidacion_('dia', 'No se puede registrar un día futuro.');
    }

    var estadoDia = String(data.estado_dia || '').trim();
    if (REGISTRO_DIA_ESTADOS_.indexOf(estadoDia) === -1) {
      return errorValidacion_('estado_dia', 'Estado del día no válido.');
    }

    var horas;
    if (data.horas !== undefined && data.horas !== null && data.horas !== '') {
      horas = Number(data.horas);
      if (isNaN(horas) || horas < 0 || horas > 24) {
        return errorValidacion_('horas', 'Las horas deben ser un número entre 0 y 24.');
      }
    }

    // Bloqueo requiere motivo: un bloqueo sin causa no se puede desatascar
    // ni escalar. Misma regla que ya exige Actividades al bloquear una tarea.
    var bloqueoMotivo = String(data.bloqueo_motivo || '').trim();
    if (estadoDia === 'bloqueado' && !bloqueoMotivo) {
      return errorValidacion_('bloqueo_motivo', 'Un día bloqueado necesita un motivo.');
    }

    // Tramos horarios opcionales ("de la 9 a la 11 hice X"): se validan de
    // forma (desde/hasta como texto corto) sin imponer un formato de reloj
    // rígido -- son una ayuda de contexto, no un fichaje.
    var tramos = [];
    if (Array.isArray(data.tramos)) {
      tramos = data.tramos.map(function (t) {
        return {
          desde: String((t && t.desde) || '').slice(0, 5),
          hasta: String((t && t.hasta) || '').slice(0, 5),
          nota: String((t && t.nota) || '').slice(0, 200)
        };
      }).filter(function (t) { return t.desde || t.hasta || t.nota; });
    }

    var nota = String(data.nota || '').slice(0, 2000);
    var ahora = new Date().toISOString();

    // UPSERT por (actividad_id, día): buscamos un REGISTRO_DIA existente de
    // esa tarea para ese día.
    var existente = leerFilasSeguro_(SHEETS.ACTIVIDADES_BITACORA).filter(function (b) {
      if (b.tipo !== 'REGISTRO_DIA' || b.actividad_id !== actividad.actividad_id) return false;
      var d = datosDeBitacora_(b);
      return d.dia === dia;
    })[0];

    var datos = {
      dia: dia,
      estado_dia: estadoDia,
      horas: (horas !== undefined) ? horas : '',
      bloqueo_motivo: bloqueoMotivo,
      tramos: tramos,
      creado_por: email,
      creado_en: (existente ? (datosDeBitacora_(existente).creado_en || ahora) : ahora),
      editado_por: email,
      editado_en: ahora,
      ediciones: []
    };

    // timestamp = mediodía del día registrado, para que la Carta lo ubique
    // en la columna correcta sin depender de la hora real de edición.
    var timestampDia = dia + 'T13:00:00.000Z';

    if (existente) {
      var previo = datosDeBitacora_(existente);
      // Historial antes→después: guardamos una foto de la versión anterior
      // (sin arrastrar su propio historial, para no crecer sin límite).
      var edicionesPrevias = Array.isArray(previo.ediciones) ? previo.ediciones : [];
      edicionesPrevias.push({
        estado_dia: previo.estado_dia || '',
        horas: (previo.horas !== undefined) ? previo.horas : '',
        nota: existente.nota || '',
        bloqueo_motivo: previo.bloqueo_motivo || '',
        editado_por: previo.editado_por || previo.creado_por || '',
        editado_en: previo.editado_en || previo.creado_en || existente.timestamp || ''
      });
      // Tope defensivo: conservamos las últimas 50 versiones (más que
      // suficiente para trazabilidad; evita una celda JSON gigante).
      datos.ediciones = edicionesPrevias.slice(-50);
      actualizarFilaPorId_(SHEETS.ACTIVIDADES_BITACORA, 'bitacora_id', existente.bitacora_id, {
        nota: nota,
        avance_pct: '',
        confianza: '',
        datos: JSON.stringify(datos),
        autor_nombre: (contexto && contexto.nombre) || existente.autor_nombre || '',
        timestamp: timestampDia
      });
    } else {
      agregarFila_(SHEETS.ACTIVIDADES_BITACORA, {
        bitacora_id: Utilities.getUuid(),
        actividad_id: actividad.actividad_id,
        tipo: 'REGISTRO_DIA',
        autor_email: (contexto && contexto.email) || '',
        autor_nombre: (contexto && contexto.nombre) || '',
        nota: nota,
        avance_pct: '',
        confianza: '',
        datos: JSON.stringify(datos),
        timestamp: timestampDia
      });
    }

    // La tarea "se movió": refrescamos ultima_actualizacion para que salud/
    // digest la vean, igual que hace un check-in.
    actualizarFilaPorId_(SHEETS.ACTIVIDADES, 'actividad_id', actividad.actividad_id,
      { ultima_actualizacion: ahora });

    return { ok: true, dia: dia, estado_dia: estadoDia, editado: !!existente };
  },

  // v12.5 ("eliminar un registro del día"): borra el REGISTRO_DIA de una
  // (tarea, día) -- p. ej. si se registró un fin de semana por error. Mismo
  // permiso que guardar (trabaja la tarea O gestiona el proyecto). A
  // diferencia del UPSERT versionado de guardarRegistroDia, aquí SÍ se quita
  // la fila: un registro equivocado no debe quedar en la Carta ni contar horas
  // -- es una corrección, no un evento de auditoría. Los demás eventos de la
  // bitácora (check-ins, entregas) NO se tocan.
  eliminarRegistroDia: function (data, contexto) {
    data = data || {};
    var proyecto = buscarProyecto_(data.proyecto_id);
    if (!proyecto) return errorValidacion_('proyecto_id', 'Proyecto no encontrado.');
    if (!puedeVerProyecto_(proyecto, contexto)) {
      return { _forbidden: true, message: 'No tienes acceso a este proyecto.' };
    }
    var actividad = leerFilasSeguro_(SHEETS.ACTIVIDADES).filter(function (a) {
      return a.actividad_id === data.actividad_id && a.proyecto_id === proyecto.proyecto_id;
    })[0];
    if (!actividad) return errorValidacion_('actividad_id', 'Tarea no encontrada en este proyecto.');

    var email = normalizarEmailProyecto_(contexto && contexto.email);
    if (!trabajaLaActividad_(actividad, email) && !puedeGestionarProyecto_(proyecto, contexto)) {
      return { _forbidden: true, message: 'Solo quien trabaja la tarea o el líder del proyecto puede eliminar el registro.' };
    }

    var dia = String(data.dia || '').trim();
    if (!/^\d{4}-\d{2}-\d{2}$/.test(dia)) {
      return errorValidacion_('dia', 'El día debe tener formato AAAA-MM-DD.');
    }

    var existente = leerFilasSeguro_(SHEETS.ACTIVIDADES_BITACORA).filter(function (b) {
      if (b.tipo !== 'REGISTRO_DIA' || b.actividad_id !== actividad.actividad_id) return false;
      return datosDeBitacora_(b).dia === dia;
    })[0];
    if (!existente) return errorValidacion_('dia', 'No hay un registro para ese día.');

    eliminarFilasPorId_(SHEETS.ACTIVIDADES_BITACORA, 'bitacora_id', existente.bitacora_id);
    actualizarFilaPorId_(SHEETS.ACTIVIDADES, 'actividad_id', actividad.actividad_id,
      { ultima_actualizacion: new Date().toISOString() });
    return { ok: true, dia: dia, eliminado: true };
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

    // v11 (P1, "Plan · Esperado · Real"): a diferencia de por_tarea (arriba,
    // solo tareas con meta_cantidad), esto es TODA tarea activa -- es sobre
    // fechas, no sobre unidades. "Esperado a hoy" asume avance LINEAL entre
    // fecha_creacion y fecha_compromiso (el mismo supuesto simple que usa
    // SPI en MS Project, documentado y visible, no una IA prediciendo nada).
    // "Real" es avance_pct si existe; si no, se infiere de estados terminales
    // (TERMINADA=100, NO_INICIADA=0) -- para EN_CURSO/BLOQUEADA sin
    // avance_pct explicito no hay numero: mejor "sin dato" que inventar uno
    // (mismo criterio que calcularAvanceProyecto_/G3).
    var baseline = obtenerUltimaBaseline_(proyecto.proyecto_id);
    var ahora = new Date();
    var planSeguimiento = tareas.map(function (a) {
      var real = avanceRealTarea_(a);
      var esperado = calcularAvanceEsperado_(a.fecha_creacion, a.fecha_compromiso, ahora);
      var baseTarea = baseline && baseline.por_tarea[a.actividad_id];
      return {
        actividad_id: a.actividad_id,
        plan_inicio: a.fecha_creacion || '',
        plan_fin: a.fecha_compromiso || '',
        baseline_inicio: baseTarea ? baseTarea.fecha_inicio : '',
        baseline_fin: baseTarea ? baseTarea.fecha_fin : '',
        avance_real_pct: real,
        avance_esperado_pct: esperado,
        desviacion_pp: (real !== null && esperado !== null) ? Math.round((real - esperado) * 10) / 10 : null,
        // v11 (P3, "SPI conceptual"): real/esperado como razón (1.0 = a
        // tiempo, <1 atrasada, >1 adelantada) -- mismo dato que
        // desviacion_pp, en la forma de índice que usa el Schedule
        // Performance Index de EVM. Documentado como "conceptual" a
        // propósito: no es una implementación de EVM completa (no hay
        // costo/CPI -- SIGSO no tiene un campo de valor monetario, decisión
        // ya tomada en la Fase G4b de este mismo módulo), es la MISMA
        // desviación de siempre, solo que expresada como índice.
        spi: (real !== null && esperado > 0) ? Math.round((real / esperado) * 100) / 100 : null
      };
    });

    return {
      por_tarea: porTarea,
      promedio_unidades_dia: conRitmo.length
        ? Math.round((conRitmo.reduce(function (s, t) { return s + t.unidades_por_dia; }, 0) / conRitmo.length) * 10) / 10
        : null,
      horas_totales_proyecto: horasTotalesProyecto ? Math.round(horasTotalesProyecto * 10) / 10 : 0,
      tareas_sin_avance: tareas.filter(function (a) { return a.estado === 'NO_INICIADA'; }).length,
      cumplimiento_tareas: calcularCumplimientoTareasProyecto_(tareas),
      plan_seguimiento: planSeguimiento,
      baseline: baseline ? { timestamp: baseline.timestamp, autor_nombre: baseline.autor_nombre } : null
    };
  },

  // v11 (P3, "analítica avanzada -- explicable, no una metodología
  // completa"): lead time, cycle time, tiempo en bloqueo, tiempo en
  // revisión -- las 4 métricas conceptuales del roadmap que SÍ se pueden
  // calcular con datos que YA existen (fechas de ACTIVIDADES + eventos de
  // ACTIVIDADES_BITACORA). Deliberadamente NO incluye CPI: exigiría un
  // campo de costo/valor que SIGSO no tiene (misma razón por la que la Fase
  // G4b, "peso de valor por tarea/cliente", quedó diferida en su momento) --
  // agregarlo ahora sería inventar un número sin respaldo real.
  obtenerAnalitica: function (data, contexto) {
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
    var bitacoraPorTarea = {};
    leerFilasSeguro_(SHEETS.ACTIVIDADES_BITACORA).forEach(function (b) {
      if (!idsTarea[b.actividad_id]) return;
      (bitacoraPorTarea[b.actividad_id] = bitacoraPorTarea[b.actividad_id] || []).push(b);
    });

    var ahora = new Date();
    var porTarea = tareas.map(function (a) {
      var eventos = bitacoraPorTarea[a.actividad_id] || [];
      return {
        actividad_id: a.actividad_id,
        titulo: a.titulo,
        lead_time_dias: calcularLeadTimeDias_(a),
        cycle_time_dias: calcularCycleTimeDias_(a, eventos),
        tiempo_bloqueo_dias: redond1Analitica_(sumarIntervalosBitacora_(eventos, ['BLOQUEO'], ['DESBLOQUEO', 'ENTREGA'], ahora)),
        // Una tarea que nunca requiere validación nunca entra en
        // EN_REVISION -- no tiene sentido medirle un tiempo ahí.
        tiempo_revision_dias: a.requiere_validacion
          ? redond1Analitica_(sumarIntervalosBitacora_(eventos, ['ENTREGA'], ['VALIDACION'], ahora))
          : 0
      };
    });

    function promedioDe_(campo) {
      var valores = porTarea.map(function (t) { return t[campo]; }).filter(function (v) { return v !== null && v !== undefined; });
      if (!valores.length) return null;
      return redond1Analitica_(valores.reduce(function (s, v) { return s + v; }, 0) / valores.length);
    }
    function sumaDe_(campo) {
      return redond1Analitica_(porTarea.reduce(function (s, t) { return s + (t[campo] || 0); }, 0));
    }
    var spiValores = tareas.map(function (a) {
      var real = avanceRealTarea_(a);
      var esperado = calcularAvanceEsperado_(a.fecha_creacion, a.fecha_compromiso, ahora);
      return (real !== null && esperado > 0) ? real / esperado : null;
    }).filter(function (v) { return v !== null; });

    return {
      por_tarea: porTarea,
      lead_time_promedio_dias: promedioDe_('lead_time_dias'),
      cycle_time_promedio_dias: promedioDe_('cycle_time_dias'),
      tiempo_bloqueo_total_dias: sumaDe_('tiempo_bloqueo_dias'),
      tiempo_revision_total_dias: sumaDe_('tiempo_revision_dias'),
      spi_promedio: spiValores.length ? Math.round((spiValores.reduce(function (s, v) { return s + v; }, 0) / spiValores.length) * 100) / 100 : null
    };
  },

  // v11 (P3, "workload cruzado multi-proyecto"): la MISMA vista Workload de
  // un proyecto (P2), pero cruzando TODOS los proyectos que este usuario
  // puede ver -- reusa Proyectos.listar (ya scopea "visibles" por rol: ADM/
  // GERENCIA ven todo el portafolio, cualquier otro solo sus propios
  // proyectos, mismo criterio que getResumenPortafolio). No hay gate de rol
  // extra acá: la visibilidad YA la resuelve listar().
  obtenerWorkloadPortafolio: function (data, contexto) {
    var proyectosVisibles = Proyectos.listar({}, contexto).filter(function (p) {
      return p.estado !== 'CERRADO' && p.estado !== 'CANCELADO';
    });
    var nombrePorProyecto = {};
    var idsProyecto = {};
    proyectosVisibles.forEach(function (p) { nombrePorProyecto[p.proyecto_id] = p.nombre; idsProyecto[p.proyecto_id] = true; });

    var tareas = leerFilasSeguro_(SHEETS.ACTIVIDADES).filter(function (a) {
      var activa = a.activa === true || a.activa === 'TRUE' || a.activa === 1;
      return activa && a.proyecto_id && idsProyecto[a.proyecto_id];
    }).map(function (a) {
      return {
        actividad_id: a.actividad_id, titulo: a.titulo, estado: a.estado, semaforo: semaforoActividad_(a).codigo,
        responsable_email: a.responsable_email, responsable_nombre: a.responsable_nombre,
        proyecto_id: a.proyecto_id, proyecto_nombre: nombrePorProyecto[a.proyecto_id] || ''
      };
    });
    var idsTarea = {};
    tareas.forEach(function (a) { idsTarea[a.actividad_id] = true; });
    var bitacora = leerFilasSeguro_(SHEETS.ACTIVIDADES_BITACORA)
      .filter(function (b) { return idsTarea[b.actividad_id]; })
      .map(filaBitacoraSalida_);

    return {
      proyectos: proyectosVisibles.map(function (p) { return { proyecto_id: p.proyecto_id, nombre: p.nombre }; }),
      tareas: tareas,
      bitacora: bitacora
    };
  },

  // v11 (P1, "congelar línea base"): guarda una FOTO de fecha_creacion→
  // fecha_compromiso de cada tarea activa como un evento más de
  // PROYECTO_EVENTOS (tipo BASELINE, cuerpo=JSON) -- mismo patrón que P0
  // (REGISTRO_DIA dentro de ACTIVIDADES_BITACORA): cero hoja nueva, cero
  // columna nueva. Volver a congelar (tras una reprogramación grande) crea
  // OTRA foto; la más reciente es LA baseline vigente para comparar contra
  // el plan actual -- las anteriores quedan en el historial de la Sala, no
  // se pierden, solo dejan de ser "la" referencia activa.
  congelarBaseline: function (data, contexto) {
    var proyecto = buscarProyecto_(data && data.proyecto_id);
    if (!proyecto) return errorValidacion_('proyecto_id', 'Proyecto no encontrado.');
    if (!puedeGestionarProyecto_(proyecto, contexto)) {
      return { _forbidden: true, message: 'Solo el líder del proyecto (o ADM) puede congelar la línea base.' };
    }
    var tareas = leerFilasSeguro_(SHEETS.ACTIVIDADES).filter(function (a) {
      var activa = a.activa === true || a.activa === 'TRUE' || a.activa === 1;
      return activa && a.proyecto_id === proyecto.proyecto_id;
    });
    var snapshot = tareas.map(function (a) {
      return { actividad_id: a.actividad_id, titulo: a.titulo, fecha_inicio: a.fecha_creacion || '', fecha_fin: a.fecha_compromiso || '' };
    });
    var evento = registrarEventoProyecto_(proyecto.proyecto_id, 'BASELINE', contexto,
      'Línea base congelada (' + snapshot.length + ' tarea[s])', '', '', JSON.stringify({ tareas: snapshot }));
    return { ok: true, evento_id: evento.evento_id, timestamp: evento.timestamp, total_tareas: snapshot.length };
  },

  // v11 (P1, "historial de fecha"): reprograma fecha_compromiso de una tarea
  // DEL PROYECTO, con motivo obligatorio -- delega en Actividades.reprogramar
  // (RN-703), cuyo permiso (responsable/supervisor/ADM) YA calza con
  // Proyectos sin tocar nada: crearTarea deja al líder del proyecto como
  // supervisor_email por defecto (ver crearTarea), así que "supervisor" ahí
  // ES "líder del proyecto". Esta capa solo confirma que la tarea es de ESTE
  // proyecto y que quien pide puede al menos VERLO, antes de delegar.
  reprogramarTarea: function (data, contexto) {
    var proyecto = buscarProyecto_(data && data.proyecto_id);
    if (!proyecto) return errorValidacion_('proyecto_id', 'Proyecto no encontrado.');
    if (!puedeVerProyecto_(proyecto, contexto)) {
      return { _forbidden: true, message: 'No tienes acceso a este proyecto.' };
    }
    var actividad = leerFilasSeguro_(SHEETS.ACTIVIDADES).filter(function (a) {
      return a.actividad_id === data.actividad_id && a.proyecto_id === proyecto.proyecto_id;
    })[0];
    if (!actividad) return errorValidacion_('actividad_id', 'Tarea no encontrada en este proyecto.');
    return Actividades.reprogramar(data, contexto);
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

  // --- Documentos (Fase 4, "centro documental"): repositorio FORMAL, con
  // categoría, versionado real e historial -- distinto del adjunto suelto de
  // la Sala (subirAdjunto/descargarAdjunto, arriba), que sigue existiendo
  // igual para el archivo rápido de conversación. Mismo patrón ya probado en
  // Calidad.gs (SGC_DOCUMENTOS/SGC_DOC_VERSIONES, documento controlado ISO),
  // sin los campos propios de esa norma (clausulas, acuse, área) -- un
  // documento de proyecto no necesita ese formalismo, solo trazabilidad.
  gestionarDocumento: function (data, contexto) {
    var proyecto = buscarProyecto_(data.proyecto_id);
    if (!proyecto) return errorValidacion_('proyecto_id', 'Proyecto no encontrado.');
    var rol = rolEnProyecto_(proyecto.proyecto_id, contexto);
    var puedeGestionar = contexto.rol === 'ADM' || rol === 'LIDER' || rol === 'INTEGRANTE' || rol === 'COLABORADOR';
    if (!puedeGestionar) return { _forbidden: true, message: 'No puedes gestionar documentos en este proyecto.' };

    if (data.accion === 'eliminar') {
      if (!data.documento_id) return errorValidacion_('documento_id', 'Falta indicar el documento.');
      var paraEliminar = buscarDocumentoProyecto_(data.documento_id);
      if (!paraEliminar || paraEliminar.proyecto_id !== proyecto.proyecto_id) {
        return errorValidacion_('documento_id', 'Documento no encontrado.');
      }
      // Soft-delete (igual criterio que el resto del módulo: nunca se pierde
      // historial). Las versiones en PROYECTO_DOC_VERSIONES y los archivos en
      // Drive quedan intactos -- si algún día se necesita, sigue ahí.
      return actualizarFilaPorId_(SHEETS.PROYECTO_DOCUMENTOS, 'documento_id', data.documento_id, { activo: false });
    }

    // Referencia opcional a una tarea o un hito -- RN-709 de siempre: debe
    // ser del MISMO proyecto (nunca un enlace cruzado a otro proyecto).
    var refTipo = '', refId = '';
    if (data.ref_tipo === 'ACTIVIDAD' && data.ref_id) {
      var tareaRef = leerFilasSeguro_(SHEETS.ACTIVIDADES).filter(function (a) { return a.actividad_id === data.ref_id; })[0];
      if (!tareaRef || tareaRef.proyecto_id !== proyecto.proyecto_id) {
        return errorValidacion_('ref_id', 'La tarea indicada no pertenece a este proyecto.');
      }
      refTipo = 'ACTIVIDAD'; refId = data.ref_id;
    } else if (data.ref_tipo === 'HITO' && data.ref_id) {
      var hitoRef = leerFilasSeguro_(SHEETS.PROYECTO_HITOS).filter(function (h) { return h.hito_id === data.ref_id; })[0];
      if (!hitoRef || hitoRef.proyecto_id !== proyecto.proyecto_id) {
        return errorValidacion_('ref_id', 'El hito indicado no pertenece a este proyecto.');
      }
      refTipo = 'HITO'; refId = data.ref_id;
    } else if (data.ref_tipo === 'REUNION' && data.ref_id) {
      // v13 (Fase 5): "documentos asociados" de una reunión -- sin columna
      // nueva, reusa este mismo mecanismo de referencia.
      var reunionRef = buscarReunionProyecto_(data.ref_id);
      if (!reunionRef || reunionRef.proyecto_id !== proyecto.proyecto_id) {
        return errorValidacion_('ref_id', 'La reunión indicada no pertenece a este proyecto.');
      }
      refTipo = 'REUNION'; refId = data.ref_id;
    } else if (data.ref_tipo === 'DECISION' && data.ref_id) {
      // v13 (Fase 5): "documentos asociados" de una decisión.
      var decisionRef = buscarDecisionProyecto_(data.ref_id);
      if (!decisionRef || decisionRef.proyecto_id !== proyecto.proyecto_id) {
        return errorValidacion_('ref_id', 'La decisión indicada no pertenece a este proyecto.');
      }
      refTipo = 'DECISION'; refId = data.ref_id;
    }

    if (data.documento_id) {
      // Editar METADATA (nombre/categoría/descripción/referencia) -- nunca el
      // archivo desde aquí, eso es subirVersionDocumento (deja traza propia).
      var actual = buscarDocumentoProyecto_(data.documento_id);
      if (!actual || actual.proyecto_id !== proyecto.proyecto_id) {
        return errorValidacion_('documento_id', 'Documento no encontrado.');
      }
      var cambios = { ref_tipo: refTipo, ref_id: refId };
      if (data.nombre !== undefined) {
        var nombreEdit = String(data.nombre || '').trim();
        if (!nombreEdit) return errorValidacion_('nombre', 'El nombre del documento es obligatorio.');
        cambios.nombre = nombreEdit;
      }
      if (data.categoria !== undefined) {
        cambios.categoria = PROYECTO_DOC_CATEGORIAS_.indexOf(data.categoria) !== -1 ? data.categoria : 'OTRO';
      }
      if (data.descripcion !== undefined) cambios.descripcion = data.descripcion || '';
      return actualizarFilaPorId_(SHEETS.PROYECTO_DOCUMENTOS, 'documento_id', data.documento_id, cambios);
    }

    // Crear: exige nombre + primer archivo -- un documento sin ninguna
    // versión no tiene sentido en un repositorio (a diferencia del adjunto
    // suelto de la Sala, este SIEMPRE nace versionado).
    var nombre = String(data.nombre || '').trim();
    if (!nombre) return errorValidacion_('nombre', 'El nombre del documento es obligatorio.');
    if (!data.contenido_base64) return errorValidacion_('contenido_base64', 'Adjunta el archivo del documento.');
    var archivo = subirArchivoDocumentoProyecto_(data, proyecto);
    if (archivo._validationError) return archivo;

    var documentoId = Utilities.getUuid();
    var categoria = PROYECTO_DOC_CATEGORIAS_.indexOf(data.categoria) !== -1 ? data.categoria : 'OTRO';
    var version = 'v1';
    var doc = {
      documento_id: documentoId, proyecto_id: proyecto.proyecto_id, nombre: nombre,
      categoria: categoria, descripcion: data.descripcion || '',
      ref_tipo: refTipo, ref_id: refId,
      version_vigente: version, archivo_id: archivo.archivo_id, archivo_nombre: archivo.archivo_nombre,
      archivo_mime: archivo.archivo_mime, tamano_bytes: archivo.tamano_bytes,
      creado_por: contexto.email || '', fecha_creacion: new Date().toISOString(), activo: true
    };
    agregarFila_(SHEETS.PROYECTO_DOCUMENTOS, doc);
    registrarVersionDocumentoProyecto_(documentoId, version, data.comentario || 'Carga inicial', archivo, contexto);
    registrarEventoProyecto_(proyecto.proyecto_id, 'ARCHIVO', contexto,
      'Documento: ' + nombre, 'DOCUMENTO', documentoId, '');
    return buscarDocumentoProyecto_(documentoId);
  },

  // Sube una nueva versión de un documento EXISTENTE -- la anterior deja de
  // ser vigente pero se conserva completa (nunca se borra, es el historial
  // auditable "qué versión regía en qué fecha").
  subirVersionDocumento: function (data, contexto) {
    var proyecto = buscarProyecto_(data.proyecto_id);
    if (!proyecto) return errorValidacion_('proyecto_id', 'Proyecto no encontrado.');
    var rol = rolEnProyecto_(proyecto.proyecto_id, contexto);
    if (!(contexto.rol === 'ADM' || rol === 'LIDER' || rol === 'INTEGRANTE' || rol === 'COLABORADOR')) {
      return { _forbidden: true, message: 'No puedes subir versiones en este proyecto.' };
    }
    var doc = buscarDocumentoProyecto_(data.documento_id);
    if (!doc || doc.proyecto_id !== proyecto.proyecto_id) return errorValidacion_('documento_id', 'Documento no encontrado.');
    if (!data.contenido_base64) return errorValidacion_('contenido_base64', 'Adjunta el archivo de la nueva versión.');
    var archivo = subirArchivoDocumentoProyecto_(data, proyecto);
    if (archivo._validationError) return archivo;
    var version = siguienteVersionDocumentoProyecto_(doc.documento_id);
    registrarVersionDocumentoProyecto_(doc.documento_id, version, data.comentario || '', archivo, contexto);
    registrarEventoProyecto_(proyecto.proyecto_id, 'ARCHIVO', contexto,
      'Nueva versión (' + version + '): ' + doc.nombre, 'DOCUMENTO', doc.documento_id, '');
    return buscarDocumentoProyecto_(doc.documento_id);
  },

  // "Marcar vigente" (rollback): vuelve a poner una versión ANTERIOR como la
  // vigente, sin borrar la que hoy lo es -- para cuando una versión nueva
  // resultó ser un error. Exclusivo de quien gestiona el proyecto (no
  // cualquier colaborador, a diferencia de subir una versión nueva).
  marcarVersionVigente: function (data, contexto) {
    var proyecto = buscarProyecto_(data.proyecto_id);
    if (!proyecto) return errorValidacion_('proyecto_id', 'Proyecto no encontrado.');
    if (!puedeGestionarProyecto_(proyecto, contexto)) {
      return { _forbidden: true, message: 'Solo el líder del proyecto o un administrador pueden cambiar la versión vigente.' };
    }
    var doc = buscarDocumentoProyecto_(data.documento_id);
    if (!doc || doc.proyecto_id !== proyecto.proyecto_id) return errorValidacion_('documento_id', 'Documento no encontrado.');
    var version = leerFilasSeguro_(SHEETS.PROYECTO_DOC_VERSIONES).filter(function (v) {
      return v.version_id === data.version_id && v.documento_id === doc.documento_id;
    })[0];
    if (!version) return errorValidacion_('version_id', 'Versión no encontrada.');
    leerFilasSeguro_(SHEETS.PROYECTO_DOC_VERSIONES).forEach(function (v) {
      if (v.documento_id === doc.documento_id) {
        actualizarFilaPorId_(SHEETS.PROYECTO_DOC_VERSIONES, 'version_id', v.version_id, { vigente: v.version_id === version.version_id });
      }
    });
    actualizarFilaPorId_(SHEETS.PROYECTO_DOCUMENTOS, 'documento_id', doc.documento_id, {
      version_vigente: version.version, archivo_id: version.archivo_id, archivo_nombre: version.archivo_nombre,
      archivo_mime: version.archivo_mime, tamano_bytes: version.tamano_bytes || 0
    });
    registrarEventoProyecto_(proyecto.proyecto_id, 'ARCHIVO', contexto,
      'Vigente cambiada a ' + version.version + ': ' + doc.nombre, 'DOCUMENTO', doc.documento_id, '');
    return buscarDocumentoProyecto_(doc.documento_id);
  },

  // Historial completo de un documento -- pedido LAZY (solo cuando alguien
  // abre "Ver historial"), igual criterio que la bitácora del Cronograma.
  listarVersionesDocumento: function (data, contexto) {
    var proyecto = buscarProyecto_(data.proyecto_id);
    if (!proyecto) return errorValidacion_('proyecto_id', 'Proyecto no encontrado.');
    if (!puedeVerProyecto_(proyecto, contexto)) return { _forbidden: true, message: 'No tienes acceso a este proyecto.' };
    var doc = buscarDocumentoProyecto_(data.documento_id);
    if (!doc || doc.proyecto_id !== proyecto.proyecto_id) return errorValidacion_('documento_id', 'Documento no encontrado.');
    return leerFilasSeguro_(SHEETS.PROYECTO_DOC_VERSIONES)
      .filter(function (v) { return v.documento_id === doc.documento_id; })
      .sort(function (a, b) { return new Date(b.fecha) - new Date(a.fecha); });
  },

  // Sirve una versión puntual (no necesariamente la vigente) -- re-valida el
  // acceso al proyecto en cada descarga, mismo criterio que descargarAdjunto.
  descargarVersionDocumento: function (data, contexto) {
    var proyecto = buscarProyecto_(data.proyecto_id);
    if (!proyecto) return errorValidacion_('proyecto_id', 'Proyecto no encontrado.');
    if (!puedeVerProyecto_(proyecto, contexto)) return { _forbidden: true, message: 'No tienes acceso a este proyecto.' };
    var version = leerFilasSeguro_(SHEETS.PROYECTO_DOC_VERSIONES).filter(function (v) { return v.version_id === data.version_id; })[0];
    if (!version) return errorValidacion_('version_id', 'Versión no encontrada.');
    var doc = buscarDocumentoProyecto_(version.documento_id);
    if (!doc || doc.proyecto_id !== proyecto.proyecto_id) return errorValidacion_('version_id', 'Versión no encontrada en este proyecto.');
    var archivo;
    try {
      archivo = DriveApp.getFileById(version.archivo_id);
    } catch (err) {
      return errorValidacion_('version_id', 'El archivo ya no está disponible en Drive.');
    }
    var blob = archivo.getBlob();
    return {
      contenido_base64: Utilities.base64Encode(blob.getBytes()),
      nombre_archivo: version.archivo_nombre,
      mime: blob.getContentType()
    };
  },

  // Descarga directa de la versión VIGENTE de un documento -- usa el
  // archivo_id ya denormalizado en PROYECTO_DOCUMENTOS, sin tener que
  // resolver primero el version_id (eso es lo que hace posible el botón
  // "Descargar" de la lista, sin un viaje extra a listarVersionesDocumento).
  descargarDocumento: function (data, contexto) {
    var proyecto = buscarProyecto_(data.proyecto_id);
    if (!proyecto) return errorValidacion_('proyecto_id', 'Proyecto no encontrado.');
    if (!puedeVerProyecto_(proyecto, contexto)) return { _forbidden: true, message: 'No tienes acceso a este proyecto.' };
    var doc = buscarDocumentoProyecto_(data.documento_id);
    if (!doc || doc.proyecto_id !== proyecto.proyecto_id) return errorValidacion_('documento_id', 'Documento no encontrado.');
    var archivo;
    try {
      archivo = DriveApp.getFileById(doc.archivo_id);
    } catch (err) {
      return errorValidacion_('documento_id', 'El archivo ya no está disponible en Drive.');
    }
    var blob = archivo.getBlob();
    return {
      contenido_base64: Utilities.base64Encode(blob.getBytes()),
      nombre_archivo: doc.archivo_nombre,
      mime: blob.getContentType()
    };
  },

  // --- Reuniones (Fase 5, "reuniones formales") ---------------------------
  //
  // Eleva el evento REUNION de la Sala (texto libre) a una entidad
  // estructurada: fecha, participantes, objetivo, minuta y ACUERDOS propios
  // -- cada uno con su propio ref_tipo/ref_id, porque "¿ya se convirtió en
  // tarea?" es una pregunta POR ACUERDO, no por reunión completa. Sigue
  // posteando un evento REUNION en la Sala (autorreferenciado, mismo
  // criterio que ENTREGABLE/RIESGO/ARCHIVO) para no perder continuidad en
  // el feed -- la reunión estructurada es la fuente completa.
  gestionarReunion: function (data, contexto) {
    var proyecto = buscarProyecto_(data.proyecto_id);
    if (!proyecto) return errorValidacion_('proyecto_id', 'Proyecto no encontrado.');
    var rol = rolEnProyecto_(proyecto.proyecto_id, contexto);
    var puedeGestionar = contexto.rol === 'ADM' || rol === 'LIDER' || rol === 'INTEGRANTE' || rol === 'COLABORADOR';
    if (!puedeGestionar) return { _forbidden: true, message: 'No puedes gestionar reuniones en este proyecto.' };

    if (data.accion === 'eliminar') {
      if (!data.reunion_id) return errorValidacion_('reunion_id', 'Falta indicar la reunión.');
      var paraEliminar = buscarReunionProyecto_(data.reunion_id);
      if (!paraEliminar || paraEliminar.proyecto_id !== proyecto.proyecto_id) {
        return errorValidacion_('reunion_id', 'Reunión no encontrada.');
      }
      var acuerdosExistentes = leerFilasSeguro_(SHEETS.PROYECTO_REUNION_ACUERDOS)
        .filter(function (a) { return a.reunion_id === data.reunion_id; });
      if (acuerdosExistentes.some(function (a) { return a.ref_id; })) {
        return errorValidacion_('reunion_id', 'Esta reunión tiene acuerdos ya convertidos en tarea; no se puede eliminar (perdería la trazabilidad).');
      }
      eliminarFilasPorId_(SHEETS.PROYECTO_REUNION_ACUERDOS, 'reunion_id', data.reunion_id);
      eliminarFilasPorId_(SHEETS.PROYECTO_REUNIONES, 'reunion_id', data.reunion_id);
      return { ok: true };
    }

    // Participantes: texto libre (nombre o correo) -- a diferencia de
    // colaboradores_emails en tareas, NO otorga acceso a nada, así que no
    // se restringe a integrantes del proyecto (una reunión real suele
    // incluir gente externa, ej. el cliente).
    var participantes = Array.isArray(data.participantes) ? data.participantes.filter(Boolean) : [];

    if (data.reunion_id) {
      var actual = buscarReunionProyecto_(data.reunion_id);
      if (!actual || actual.proyecto_id !== proyecto.proyecto_id) return errorValidacion_('reunion_id', 'Reunión no encontrada.');
      var cambios = {};
      if (data.titulo !== undefined) {
        var tituloEdit = String(data.titulo || '').trim();
        if (!tituloEdit) return errorValidacion_('titulo', 'El título es obligatorio.');
        cambios.titulo = tituloEdit;
      }
      if (data.fecha !== undefined) cambios.fecha = data.fecha || '';
      if (data.objetivo !== undefined) cambios.objetivo = data.objetivo || '';
      if (data.minuta !== undefined) cambios.minuta = data.minuta || '';
      if (data.participantes !== undefined) cambios.participantes = JSON.stringify(participantes);
      return actualizarFilaPorId_(SHEETS.PROYECTO_REUNIONES, 'reunion_id', data.reunion_id, cambios);
    }

    var titulo = String(data.titulo || '').trim();
    if (!titulo) return errorValidacion_('titulo', 'El título de la reunión es obligatorio.');
    var reunionId = Utilities.getUuid();
    var reunion = {
      reunion_id: reunionId, proyecto_id: proyecto.proyecto_id, titulo: titulo,
      fecha: data.fecha || new Date().toISOString(), participantes: JSON.stringify(participantes),
      objetivo: data.objetivo || '', minuta: data.minuta || '',
      creado_por: contexto.email || '', fecha_creacion: new Date().toISOString()
    };
    agregarFila_(SHEETS.PROYECTO_REUNIONES, reunion);
    // Acuerdos iniciales (opcional) -- se pueden seguir agregando después
    // con agregarAcuerdoReunion.
    var acuerdosIniciales = Array.isArray(data.acuerdos) ? data.acuerdos.filter(function (t) { return String(t || '').trim(); }) : [];
    acuerdosIniciales.forEach(function (texto, i) {
      agregarFila_(SHEETS.PROYECTO_REUNION_ACUERDOS, {
        acuerdo_id: Utilities.getUuid(), reunion_id: reunionId, texto: String(texto).trim(),
        ref_tipo: '', ref_id: '', orden: i
      });
    });
    registrarEventoProyecto_(proyecto.proyecto_id, 'REUNION', contexto,
      'Reunión: ' + titulo, 'REUNION', reunionId, data.objetivo || '');
    return buscarReunionProyecto_(reunionId);
  },

  // Agrega UN acuerdo a una reunión ya existente (la minuta se sigue
  // completando después de creada la reunión, es normal).
  agregarAcuerdoReunion: function (data, contexto) {
    var proyecto = buscarProyecto_(data.proyecto_id);
    if (!proyecto) return errorValidacion_('proyecto_id', 'Proyecto no encontrado.');
    var rol = rolEnProyecto_(proyecto.proyecto_id, contexto);
    if (!(contexto.rol === 'ADM' || rol === 'LIDER' || rol === 'INTEGRANTE' || rol === 'COLABORADOR')) {
      return { _forbidden: true, message: 'No puedes agregar acuerdos en este proyecto.' };
    }
    var reunion = buscarReunionProyecto_(data.reunion_id);
    if (!reunion || reunion.proyecto_id !== proyecto.proyecto_id) return errorValidacion_('reunion_id', 'Reunión no encontrada.');
    var texto = String(data.texto || '').trim();
    if (!texto) return errorValidacion_('texto', 'El acuerdo no puede estar vacío.');
    var totalActual = leerFilasSeguro_(SHEETS.PROYECTO_REUNION_ACUERDOS).filter(function (a) { return a.reunion_id === data.reunion_id; }).length;
    var acuerdo = { acuerdo_id: Utilities.getUuid(), reunion_id: data.reunion_id, texto: texto, ref_tipo: '', ref_id: '', orden: totalActual };
    agregarFila_(SHEETS.PROYECTO_REUNION_ACUERDOS, acuerdo);
    return acuerdo;
  },

  // Quita un acuerdo -- solo si todavía NO se convirtió en tarea (mismo
  // criterio protector que hitos: no se destruye trazabilidad ya creada).
  eliminarAcuerdoReunion: function (data, contexto) {
    var proyecto = buscarProyecto_(data.proyecto_id);
    if (!proyecto) return errorValidacion_('proyecto_id', 'Proyecto no encontrado.');
    var rol = rolEnProyecto_(proyecto.proyecto_id, contexto);
    if (!(contexto.rol === 'ADM' || rol === 'LIDER' || rol === 'INTEGRANTE' || rol === 'COLABORADOR')) {
      return { _forbidden: true, message: 'No puedes eliminar acuerdos en este proyecto.' };
    }
    var acuerdo = leerFilasSeguro_(SHEETS.PROYECTO_REUNION_ACUERDOS).filter(function (a) { return a.acuerdo_id === data.acuerdo_id; })[0];
    if (!acuerdo) return errorValidacion_('acuerdo_id', 'Acuerdo no encontrado.');
    var reunion = buscarReunionProyecto_(acuerdo.reunion_id);
    if (!reunion || reunion.proyecto_id !== proyecto.proyecto_id) return errorValidacion_('acuerdo_id', 'Acuerdo no encontrado en este proyecto.');
    if (acuerdo.ref_id) return errorValidacion_('acuerdo_id', 'Este acuerdo ya se convirtió en tarea; no se puede eliminar.');
    eliminarFilasPorId_(SHEETS.PROYECTO_REUNION_ACUERDOS, 'acuerdo_id', data.acuerdo_id);
    return { ok: true };
  },

  // Convierte UN acuerdo en tarea real -- mismo mecanismo que
  // convertirEventoEnTarea (reusa crearTarea), pero deja la traza en el
  // ACUERDO en vez de en el evento de la Sala: así "¿de dónde salió esta
  // tarea?" queda resoluble hasta el acuerdo puntual de la minuta, no solo
  // "de alguna reunión".
  convertirAcuerdoEnTarea: function (data, contexto) {
    var proyecto = buscarProyecto_(data.proyecto_id);
    if (!proyecto) return errorValidacion_('proyecto_id', 'Proyecto no encontrado.');
    var acuerdo = leerFilasSeguro_(SHEETS.PROYECTO_REUNION_ACUERDOS).filter(function (a) { return a.acuerdo_id === data.acuerdo_id; })[0];
    if (!acuerdo) return errorValidacion_('acuerdo_id', 'Acuerdo no encontrado.');
    if (acuerdo.ref_id) return errorValidacion_('acuerdo_id', 'Este acuerdo ya se convirtió en tarea.');
    var reunion = buscarReunionProyecto_(acuerdo.reunion_id);
    if (!reunion || reunion.proyecto_id !== proyecto.proyecto_id) return errorValidacion_('acuerdo_id', 'Acuerdo no encontrado en este proyecto.');
    if (!data.responsable_email) return errorValidacion_('responsable_email', 'Falta el responsable.');
    if (!data.fecha_compromiso) return errorValidacion_('fecha_compromiso', 'Falta la fecha comprometida.');
    var tarea = Proyectos.crearTarea({
      proyecto_id: proyecto.proyecto_id,
      hito_id: data.hito_id || '',
      titulo: data.titulo || acuerdo.texto,
      descripcion: 'Acuerdo de la reunión "' + reunion.titulo + '": ' + acuerdo.texto,
      responsable_email: data.responsable_email,
      fecha_compromiso: data.fecha_compromiso,
      prioridad: data.prioridad
    }, contexto);
    if (tarea && (tarea._validationError || tarea._forbidden)) return tarea;
    actualizarFilaPorId_(SHEETS.PROYECTO_REUNION_ACUERDOS, 'acuerdo_id', data.acuerdo_id, { ref_tipo: 'ACTIVIDAD', ref_id: tarea.actividad_id });
    return tarea;
  },

  // Lista las reuniones del proyecto CON sus acuerdos ya unidos -- son
  // conjuntos chicos (nadie tiene cientos de reuniones por proyecto), así
  // que traerlos siempre en un solo viaje es más simple que paginar.
  listarReuniones: function (data, contexto) {
    var proyecto = buscarProyecto_(data.proyecto_id);
    if (!proyecto) return errorValidacion_('proyecto_id', 'Proyecto no encontrado.');
    if (!puedeVerProyecto_(proyecto, contexto)) return { _forbidden: true, message: 'No tienes acceso a este proyecto.' };
    var acuerdosPorReunion = {};
    leerFilasSeguro_(SHEETS.PROYECTO_REUNION_ACUERDOS).forEach(function (a) {
      (acuerdosPorReunion[a.reunion_id] = acuerdosPorReunion[a.reunion_id] || []).push(a);
    });
    return leerFilasSeguro_(SHEETS.PROYECTO_REUNIONES)
      .filter(function (r) { return r.proyecto_id === proyecto.proyecto_id; })
      .map(function (r) {
        var participantes = [];
        try { participantes = JSON.parse(r.participantes || '[]'); } catch (e) { participantes = []; }
        var acuerdos = (acuerdosPorReunion[r.reunion_id] || []).sort(function (a, b) { return (Number(a.orden) || 0) - (Number(b.orden) || 0); });
        return {
          reunion_id: r.reunion_id, titulo: r.titulo, fecha: r.fecha, objetivo: r.objetivo, minuta: r.minuta,
          participantes: participantes, creado_por: r.creado_por, fecha_creacion: r.fecha_creacion, acuerdos: acuerdos
        };
      })
      .sort(function (a, b) { return new Date(b.fecha) - new Date(a.fecha); });
  },

  // --- Decisiones (Fase 5, "registro de decisiones") ----------------------
  //
  // Trazabilidad formal de "qué se decidió, por qué y quién es responsable"
  // -- para proyectos que después deben auditarse o explicarse (§16 del
  // encargo). "Documentos asociados" se resuelve reusando el enlace que ya
  // usan Documentos hacia tarea/hito (ver el bloque REF_TIPO en
  // gestionarDocumento) -- sin columna nueva. Sigue posteando un evento
  // DECISION en la Sala (autorreferenciado) por continuidad del feed.
  gestionarDecision: function (data, contexto) {
    var proyecto = buscarProyecto_(data.proyecto_id);
    if (!proyecto) return errorValidacion_('proyecto_id', 'Proyecto no encontrado.');
    var rol = rolEnProyecto_(proyecto.proyecto_id, contexto);
    var puedeGestionar = contexto.rol === 'ADM' || rol === 'LIDER' || rol === 'INTEGRANTE' || rol === 'COLABORADOR';
    if (!puedeGestionar) return { _forbidden: true, message: 'No puedes registrar decisiones en este proyecto.' };

    if (data.accion === 'eliminar') {
      if (!data.decision_id) return errorValidacion_('decision_id', 'Falta indicar la decisión.');
      var paraEliminar = buscarDecisionProyecto_(data.decision_id);
      if (!paraEliminar || paraEliminar.proyecto_id !== proyecto.proyecto_id) return errorValidacion_('decision_id', 'Decisión no encontrada.');
      return actualizarFilaPorId_(SHEETS.PROYECTO_DECISIONES, 'decision_id', data.decision_id, { activo: false });
    }

    if (data.decision_id) {
      var actual = buscarDecisionProyecto_(data.decision_id);
      if (!actual || actual.proyecto_id !== proyecto.proyecto_id) return errorValidacion_('decision_id', 'Decisión no encontrada.');
      var cambios = {};
      if (data.descripcion !== undefined) {
        var descripcionEdit = String(data.descripcion || '').trim();
        if (!descripcionEdit) return errorValidacion_('descripcion', 'La descripción de la decisión es obligatoria.');
        cambios.descripcion = descripcionEdit;
      }
      if (data.contexto !== undefined) cambios.contexto = data.contexto || '';
      if (data.impacto !== undefined) cambios.impacto = data.impacto || '';
      if (data.responsable_email !== undefined) cambios.responsable_email = normalizarEmailProyecto_(data.responsable_email) || proyecto.lider_email;
      if (data.fecha_decision !== undefined) cambios.fecha_decision = data.fecha_decision || '';
      return actualizarFilaPorId_(SHEETS.PROYECTO_DECISIONES, 'decision_id', data.decision_id, cambios);
    }

    var descripcion = String(data.descripcion || '').trim();
    if (!descripcion) return errorValidacion_('descripcion', 'La descripción de la decisión es obligatoria.');
    var decisionId = Utilities.getUuid();
    var decision = {
      decision_id: decisionId, proyecto_id: proyecto.proyecto_id, descripcion: descripcion,
      contexto: data.contexto || '', impacto: data.impacto || '',
      responsable_email: normalizarEmailProyecto_(data.responsable_email) || proyecto.lider_email,
      fecha_decision: data.fecha_decision || new Date().toISOString(),
      creado_por: contexto.email || '', fecha_creacion: new Date().toISOString(), activo: true
    };
    agregarFila_(SHEETS.PROYECTO_DECISIONES, decision);
    registrarEventoProyecto_(proyecto.proyecto_id, 'DECISION', contexto,
      'Decisión: ' + descripcion, 'DECISION', decisionId, data.contexto || '');
    return buscarDecisionProyecto_(decisionId);
  },

  listarDecisiones: function (data, contexto) {
    var proyecto = buscarProyecto_(data.proyecto_id);
    if (!proyecto) return errorValidacion_('proyecto_id', 'Proyecto no encontrado.');
    if (!puedeVerProyecto_(proyecto, contexto)) return { _forbidden: true, message: 'No tienes acceso a este proyecto.' };
    return leerFilasSeguro_(SHEETS.PROYECTO_DECISIONES)
      .filter(function (d) { return d.proyecto_id === proyecto.proyecto_id && esVerdaderoProyecto_(d.activo); })
      .sort(function (a, b) { return new Date(b.fecha_decision) - new Date(a.fecha_decision); });
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
    // v13 (Fase 5, "riesgo vs. problema"): RIESGO = podría ocurrir; PROBLEMA
    // = ya está ocurriendo. Sin entidad nueva -- un riesgo ABIERTO puede
    // "materializarse" (deja de ser hipotético) sin perder su historial de
    // mitigación ni su nivel. Acción propia (no el edit genérico de abajo)
    // para que quede como un evento explícito en la Sala, igual criterio que
    // marcarEntregado en Entregables.
    if (data.accion === 'materializar') {
      if (!data.riesgo_id) return errorValidacion_('riesgo_id', 'Falta indicar el riesgo.');
      var riesgoMat = buscarRiesgo_(data.riesgo_id);
      if (!riesgoMat || riesgoMat.proyecto_id !== proyecto.proyecto_id) return errorValidacion_('riesgo_id', 'Riesgo no encontrado.');
      if (riesgoMat.estado !== 'ABIERTO') return errorValidacion_('riesgo_id', 'Solo un riesgo abierto puede materializarse en problema.');
      var materializado = actualizarFilaPorId_(SHEETS.PROYECTO_RIESGOS, 'riesgo_id', data.riesgo_id, { estado: 'MATERIALIZADO' });
      registrarEventoProyecto_(proyecto.proyecto_id, 'RIESGO', contexto,
        'Riesgo materializado en problema: ' + riesgoMat.descripcion, 'RIESGO', data.riesgo_id, '');
      return materializado;
    }
    if (data.riesgo_id) {
      var actual = buscarRiesgo_(data.riesgo_id);
      if (!actual) return errorValidacion_('riesgo_id', 'Riesgo no encontrado.');
      var cambios = {};
      ['descripcion', 'responsable_email', 'mitigacion'].forEach(function (campo) {
        if (data[campo] !== undefined) cambios[campo] = data[campo];
      });
      // estado NUNCA se acepta a mano por este camino genérico -- solo
      // 'eliminar' (->CERRADO) y 'materializar' (->MATERIALIZADO) arriba
      // pueden moverlo, para que no llegue un valor inválido/arbitrario.
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
  // R-01: el proyecto entero en una hoja de calculo, para seguir
  // trabajando sobre el. Mismo gate de lectura que el PDF.
  descargarLibro: function (data, contexto) {
    var proyecto = buscarProyecto_(data && data.proyecto_id);
    if (!proyecto) return errorValidacion_('proyecto_id', 'Proyecto no encontrado.');
    if (!puedeVerProyecto_(proyecto, contexto)) {
      return { _forbidden: true, message: 'No tienes acceso a este proyecto.' };
    }
    var detalle = Proyectos.getDetalle({ proyecto_id: proyecto.proyecto_id }, contexto);
    var tareas = Proyectos.listarTareas({ proyecto_id: proyecto.proyecto_id }, contexto);
    var bitacora = Proyectos.listarBitacora({ proyecto_id: proyecto.proyecto_id }, contexto);
    var hojas = armarLibroProyecto_(detalle, tareas, bitacora);
    return generarXlsxProyecto_(proyecto, hojas);
  },

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

    // v11 ("PDF ejecutivo configurable"): sin config (un clic de siempre,
    // botón "Descargar PDF" del Resumen) el reporte es EXACTAMENTE el de
    // siempre -- cero cambio para quien nunca abre "Configurar informe".
    // Con config (secciones/rango/personas/estado elegidos en el modal
    // nuevo) se arma un documento a medida: portada, salud ponderada,
    // Gantt/workload multipágina, desviaciones Plan/Esperado/Real, etc.
    var config = normalizarConfigReporte_(data && data.config);
    var html;
    if (!config) {
      var bitacoraReciente = Proyectos.listarBitacora({ proyecto_id: proyecto.proyecto_id }, contexto).slice(-15).reverse();
      html = construirHtmlReporteProyecto_(detalle, tareas, rendimiento, bitacoraReciente, tareasPorId);
    } else {
      html = construirHtmlReporteConfigurado_(detalle, tareas, rendimiento, tareasPorId, config, contexto);
    }
    var pdf = Utilities.newBlob(html, 'text/html', 'Reporte-' + proyecto.proyecto_id + '.html').getAs('application/pdf');
    pdf.setName('Reporte - ' + proyecto.nombre + '.pdf');
    return {
      pdf_base64: Utilities.base64Encode(pdf.getBytes()),
      filename: pdf.getName()
    };
  }
};

// --- R-01: el proyecto como hoja de calculo -------------------------------

// Fecha corta y estable para una celda. No se reusa fechaCortaPdfProyecto_
// porque aquella devuelve un guion largo cuando no hay fecha: en una columna
// de fechas de Excel eso rompe el orden y el filtro. Aqui vacio es vacio. Se escribe como TEXTO y no como
// Date a proposito: el destino es un archivo que se abre en Excel en otra
// zona horaria, y una fecha "viva" se corre un dia. Aqui interesa que diga
// lo mismo que la pantalla.
function fechaLibro_(valor) {
  if (!valor) return '';
  var d = new Date(valor);
  if (isNaN(d.getTime())) return String(valor);
  return Utilities.formatDate(d, 'America/Santiago', 'dd-MM-yyyy');
}

function siNo_(v) { return v ? 'Sí' : 'No'; }

/**
 * Arma las hojas del libro. PURA: no toca Drive, ni la red, ni el reloj mas
 * alla de formatear. Devuelve [{ nombre, filas }] con la primera fila de
 * cada hoja como encabezado.
 *
 * Es la parte donde puede haber errores de verdad (una columna que cambio de
 * nombre, un dato mal mapeado), asi que es la que se prueba.
 */
function armarLibroProyecto_(detalle, tareas, bitacora) {
  var p = (detalle && detalle.proyecto) || {};
  var hojas = [];

  // Resumen: clave/valor, que es como se lee una ficha -- no una tabla de
  // una sola fila con veinte columnas que obliga a barrer de lado.
  hojas.push({ nombre: 'Resumen', filas: [
    ['Campo', 'Valor'],
    ['Proyecto', p.nombre || ''],
    ['Código', p.codigo || ''],
    ['Estado', p.estado || ''],
    ['Líder', p.lider_email || ''],
    ['Inicio', fechaLibro_(p.fecha_inicio)],
    ['Fecha objetivo', fechaLibro_(p.fecha_objetivo)],
    ['Avance real (%)', detalle.avance_pct === null || detalle.avance_pct === undefined ? '' : detalle.avance_pct],
    ['Avance esperado (%)', detalle.avance_esperado_pct === null || detalle.avance_esperado_pct === undefined ? '' : detalle.avance_esperado_pct],
    ['Salud', detalle.salud_etiqueta || ''],
    // La MISMA cifra que muestra la pantalla desde P-02: puntos en contra,
    // no una nota sobre 100 que contradiga a la etiqueta.
    ['Puntos en contra', detalle.salud_penalizacion === null || detalle.salud_penalizacion === undefined ? '' : detalle.salud_penalizacion],
    ['Motivos', (detalle.salud_motivos || []).join(' · ')],
    ['Integrantes', (detalle.integrantes || []).length],
    ['Emitido', Utilities.formatDate(new Date(), 'America/Santiago', 'dd-MM-yyyy HH:mm')]
  ] });

  var hitosPorId = {};
  (detalle.hitos || []).forEach(function (h) { hitosPorId[h.hito_id] = h.nombre; });
  var tituloPorTarea = {};
  (tareas || []).forEach(function (t) { tituloPorTarea[t.actividad_id] = t.titulo; });

  hojas.push({ nombre: 'Tareas', filas: [[
    'Título', 'Estado', 'Semáforo', 'Responsable', 'Prioridad', 'Tamaño',
    'Hito', 'Depende de', 'Ruta crítica', 'Holgura (días)',
    'Creada', 'Compromiso', 'Terminada', 'Avance (%)', 'Reprogramaciones'
  ]].concat((tareas || []).map(function (t) {
    return [
      t.titulo || '', t.estado || '', t.semaforo_etiqueta || t.semaforo || '',
      t.responsable_nombre || t.responsable_email || '', t.prioridad || '', t.tamano || '',
      hitosPorId[t.hito_id] || '',
      // El titulo, no el id: un id no le dice nada a quien abre el archivo.
      tituloPorTarea[t.depende_de] || '',
      siNo_(t.es_critica),
      (t.holgura_dias === null || t.holgura_dias === undefined) ? '' : t.holgura_dias,
      fechaLibro_(t.fecha_creacion), fechaLibro_(t.fecha_compromiso), fechaLibro_(t.fecha_terminada),
      (t.avance_pct === null || t.avance_pct === undefined || t.avance_pct === '') ? '' : Number(t.avance_pct),
      t.reprogramaciones || 0
    ];
  })) });

  hojas.push({ nombre: 'Hitos', filas: [[
    'Hito', 'Estado', 'Fecha objetivo', 'Tareas', 'Avance (%)', 'Descripción'
  ]].concat((detalle.hitos || []).map(function (h) {
    return [h.nombre || '', h.estado || '', fechaLibro_(h.fecha_objetivo),
      h.total_tareas || 0,
      (h.avance_pct === null || h.avance_pct === undefined) ? '' : h.avance_pct,
      h.descripcion || ''];
  })) });

  hojas.push({ nombre: 'Riesgos', filas: [[
    'Descripción', 'Probabilidad', 'Impacto', 'Nivel', 'Estado', 'Responsable', 'Mitigación'
  ]].concat((detalle.riesgos || []).map(function (r) {
    return [r.descripcion || '', r.probabilidad || '', r.impacto || '', r.nivel || '',
      r.estado || '', r.responsable_email || '', r.mitigacion || ''];
  })) });

  hojas.push({ nombre: 'Entregables', filas: [[
    'Entregable', 'Estado', 'Fecha comprometida', 'Responsable'
  ]].concat((detalle.entregables || []).map(function (e) {
    return [e.nombre || '', e.estado || '', fechaLibro_(e.fecha_comprometida), e.responsable_email || ''];
  })) });

  hojas.push({ nombre: 'Equipo', filas: [[
    'Nombre', 'Correo', 'Rol', 'Responsabilidad'
  ]].concat((detalle.integrantes || []).map(function (i) {
    return [i.usuario_nombre || '', i.usuario_email || '', i.rol_proyecto || '', i.responsabilidad || ''];
  })) });

  hojas.push({ nombre: 'Bitácora', filas: [[
    'Fecha', 'Tarea', 'Tipo', 'Estado del día', 'Horas', 'Detalle', 'Autor'
  ]].concat((bitacora || []).map(function (b) {
    return [fechaLibro_(b.dia || b.timestamp), tituloPorTarea[b.actividad_id] || '',
      b.tipo || '', b.estado_dia || '',
      (b.horas === null || b.horas === undefined || b.horas === '') ? '' : Number(b.horas),
      b.detalle || b.nota || '', b.autor_nombre || b.autor_email || ''];
  })) });

  return hojas;
}

/**
 * Convierte las hojas armadas en un .xlsx real.
 *
 * Crea una hoja de calculo temporal, la exporta con el exportador de Google
 * y la BORRA SIEMPRE. El try/finally no es decorativo: sin el, cada error a
 * mitad de camino dejaria un archivo huerfano en el Drive de quien descarga.
 */
function generarXlsxProyecto_(proyecto, hojas) {
  var libro = SpreadsheetApp.create('SIGSO temporal - ' + (proyecto.nombre || proyecto.proyecto_id));
  var id = libro.getId();
  try {
    hojas.forEach(function (h, i) {
      // La primera reusa la hoja que viene por defecto; el resto se crean.
      var hoja = (i === 0) ? libro.getSheets()[0] : libro.insertSheet();
      hoja.setName(h.nombre);
      if (h.filas.length) {
        // Una sola escritura por hoja: setValues por lote, no celda a celda.
        var ancho = h.filas[0].length;
        var normalizadas = h.filas.map(function (f) {
          var fila = f.slice(0, ancho);
          while (fila.length < ancho) fila.push('');
          return fila;
        });
        hoja.getRange(1, 1, normalizadas.length, ancho).setValues(normalizadas);
        hoja.getRange(1, 1, 1, ancho).setFontWeight('bold');
        hoja.setFrozenRows(1);
      }
    });
    SpreadsheetApp.flush();

    var url = 'https://docs.google.com/spreadsheets/d/' + id + '/export?format=xlsx';
    var resp = UrlFetchApp.fetch(url, {
      headers: { Authorization: 'Bearer ' + ScriptApp.getOAuthToken() },
      muteHttpExceptions: true
    });
    if (resp.getResponseCode() !== 200) {
      return { _validationError: true, message: 'No se pudo generar el archivo de Excel (' + resp.getResponseCode() + ').',
        fields: [{ campo: 'proyecto_id', mensaje: 'Reintenta en unos segundos.' }] };
    }
    return {
      xlsx_base64: Utilities.base64Encode(resp.getBlob().getBytes()),
      filename: (proyecto.nombre || 'Proyecto') + '.xlsx'
    };
  } finally {
    // SIEMPRE. Si algo falla arriba, el temporal no puede quedarse.
    try { DriveApp.getFileById(id).setTrashed(true); } catch (e) { /* ya no existe */ }
  }
}

// --- reporte PDF: construccion del HTML (Fase D, propuesta 11) -----------

var PROYECTOS_SALUD_LABEL_PDF = { normal: 'Normal', riesgo: 'En riesgo', critico: 'Crítico' };
// v12.1 ("color sobretodo"): color sólido por salud, para chips legibles en
// el PDF (el motor rinde los tintes pálidos casi blancos -> se usa saturado).
var PROYECTOS_SALUD_COLOR_PDF = { normal: '#16A34A', riesgo: '#D97706', critico: '#DC2626' };
function saludChipPdf_(salud, texto) {
  var color = PROYECTOS_SALUD_COLOR_PDF[salud] || DOC.MUTED;
  return '<span style="display:inline-block;background-color:' + color + ';color:#ffffff;font-weight:bold;' +
    'font-size:11px;padding:2px 9px;border-radius:3px;">' + escaparHtml_(texto) + '</span>';
}
// Color de una desviación en puntos porcentuales: rojo si va por debajo del
// plan, verde si está a la par o por encima.
function colorDesviacionPdf_(pp) {
  if (pp === null || pp === undefined) return DOC.MUTED;
  return pp < 0 ? '#DC2626' : '#16A34A';
}
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

// v13 (Fase 3, "reporte ejecutivo -- prioridad máxima"): el Resumen
// Ejecutivo narrativo. Responde en un párrafo lo que antes obligaba a leer
// 4-5 tablas: cómo está, avance vs plan, qué está atrasado/en riesgo,
// próximo hito y una decisión sugerida. Deliberadamente NO es texto generado
// por IA -- es una plantilla de frases condicionadas sobre las MISMAS señales
// objetivas que ya arma requiere_atencion_ (Fase 2) y calcularSaludProyecto_
// (P1): nunca una caja negra, cada frase es trazable a un número real.
// Criterio de la "prueba de los 60 segundos" del encargo: quien abre el PDF
// sin conocer el proyecto debe entender en un vistazo si va bien, qué está
// mal y qué necesita atención -- antes de llegar a cualquier tabla.
function seccionNarrativaPdf_(detalle) {
  var at = detalle.requiere_atencion || {};
  var avance = detalle.avance_pct;
  var esperado = detalle.avance_esperado_pct;
  var desviacion = (avance !== null && avance !== undefined && esperado !== null && esperado !== undefined)
    ? Math.round((avance - esperado) * 10) / 10 : null;

  var frases = [];
  var saludTxt = PROYECTOS_SALUD_LABEL_PDF[detalle.salud] || detalle.salud;
  frases.push('El proyecto está en estado <b>' + escaparHtml_(saludTxt) + '</b>' +
    (detalle.salud_penalizacion ? ' (' + detalle.salud_penalizacion + ' puntos en contra)' : '') + '.');

  if (avance === null || avance === undefined) {
    frases.push('Todavía no hay tareas activas para medir avance.');
  } else if (desviacion === null) {
    frases.push('Avance real: ' + avance + '%.');
  } else if (desviacion < -5) {
    frases.push('El avance real (' + avance + '%) está ' + Math.abs(desviacion) + ' puntos por DEBAJO de lo planificado (' + esperado + '%).');
  } else if (desviacion > 5) {
    frases.push('El avance real (' + avance + '%) está ' + desviacion + ' puntos por ENCIMA de lo planificado (' + esperado + '%).');
  } else {
    frases.push('El avance real (' + avance + '%) está en línea con lo planificado (' + esperado + '%).');
  }

  var problemas = [];
  if (at.tareas_criticas_atrasadas > 0) problemas.push(at.tareas_criticas_atrasadas + ' tarea(s) crítica(s) (P1/P2) atrasada(s)');
  if (at.tareas_bloqueadas > 0) problemas.push(at.tareas_bloqueadas + ' tarea(s) bloqueada(s)');
  if (at.hitos_atrasados > 0) problemas.push(at.hitos_atrasados + ' hito(s) vencido(s)');
  if (at.riesgos_altos > 0) problemas.push(at.riesgos_altos + ' riesgo(s) alto(s) abierto(s)');
  frases.push(problemas.length
    ? 'Requiere atención: ' + escaparHtml_(problemas.join(', ')) + '.'
    : 'No hay tareas críticas atrasadas, bloqueos, hitos vencidos ni riesgos altos abiertos en este momento.');

  var hitosVivos = (detalle.hitos || []).filter(function (h) { return h.estado !== 'COMPLETADO' && h.estado !== 'CANCELADO' && h.fecha_objetivo; })
    .sort(function (a, b) { return new Date(a.fecha_objetivo) - new Date(b.fecha_objetivo); });
  if (hitosVivos[0]) {
    frases.push('Próximo hito: <b>' + escaparHtml_(hitosVivos[0].nombre) + '</b> (' + fechaCortaPdfProyecto_(hitosVivos[0].fecha_objetivo) + ').');
  }

  // Decisión sugerida: heurística simple y transparente sobre las MISMAS
  // señales de arriba -- no reemplaza el juicio de gerencia, apunta a dónde
  // mirar primero.
  var decision;
  if (at.riesgos_altos > 0) decision = 'Revisar la mitigación de los riesgos altos abiertos.';
  else if (at.tareas_criticas_atrasadas > 0) decision = 'Priorizar destrabar las tareas críticas atrasadas.';
  else if (at.hitos_atrasados > 0) decision = 'Replanificar el/los hito(s) vencido(s) con el equipo.';
  else if (desviacion !== null && desviacion < -10) decision = 'Evaluar un ajuste de plan: el atraso acumulado supera 10 puntos.';
  else decision = 'Sin decisiones urgentes -- seguimiento normal.';

  return docSeccionOt_('Resumen ejecutivo') +
    '<p style="font-size:12px;line-height:1.6;color:' + DOC.INK_SOFT + ';margin:0 0 10px;">' + frases.join(' ') + '</p>' +
    '<table style="border-collapse:collapse;margin:0 0 18px;width:100%;"><tr>' +
      '<td style="width:3px;background:' + DOC.NAVY + ';"></td>' +
      '<td style="background:' + DOC.PANEL + ';padding:8px 12px;font-size:12px;color:' + DOC.INK + ';">' +
        '<b>Decisión sugerida para gerencia:</b> ' + escaparHtml_(decision) +
      '</td>' +
    '</tr></table>';
}

// v13 (Fase 3, "mini Gantt semanal"): agrupa el mismo tramo del proyecto
// (construirDiasReportePdf_) en semanas de lunes a domingo -- vista de PLAN
// (fecha_creacion->fecha_compromiso), no de ejecución día a día (eso ya lo
// cubre la sección 'gantt' configurable). Por eso NO necesita bitácora: es
// pura fecha de tareas + hitos, cero costo extra en el reporte clásico.
function construirSemanasReportePdf_(tareas, rango, hoyClave) {
  var dias = construirDiasReportePdf_(tareas, rango, hoyClave);
  if (!dias.length) return [];
  var semanas = [];
  var actual = null;
  dias.forEach(function (clave) {
    var dow = fechaDeClavePdf_(clave).getUTCDay(); // 0=domingo .. 1=lunes
    if (!actual || dow === 1) {
      actual = { desde: clave, hasta: clave };
      semanas.push(actual);
    }
    actual.hasta = clave;
  });
  return semanas;
}

// v13 (Fase 3): "cada semana muestra: principales actividades, hitos, tareas
// críticas y desviación" (§10 del encargo) -- NO es una captura del Gantt
// interactivo, son chips de color sólido (el motor de Apps Script rinde
// pálido casi blanco, ver v12.1) diseñados para leerse en papel. Tope de 6
// tareas por semana -- una semana con más se resume con "+N más" (mismo
// criterio que impacto_titulos/items de Atención Requerida: una lista que no
// cabe en una pantalla/página deja de comunicar).
var MINI_GANTT_TOPE_TAREAS_ = 6;
function seccionMiniGanttSemanalPdf_(tareas, hitos, rendimiento, semanas) {
  if (!semanas.length) return '';
  var planPorTarea = {};
  ((rendimiento && rendimiento.plan_seguimiento) || []).forEach(function (t) { planPorTarea[t.actividad_id] = t; });

  var bloques = semanas.map(function (sem) {
    var hitosSemana = (hitos || []).filter(function (h) {
      if (!h.fecha_objetivo) return false;
      var k = clavePdf_(new Date(h.fecha_objetivo));
      return k >= sem.desde && k <= sem.hasta;
    });
    var tareasSemana = (tareas || []).filter(function (a) {
      if (!a.fecha_compromiso) return false;
      var kCompromiso = clavePdf_(new Date(a.fecha_compromiso));
      var kCreacion = a.fecha_creacion ? clavePdf_(new Date(a.fecha_creacion)) : kCompromiso;
      // v13: normalizado con min/max -- una tarea retroactiva (creada HOY con
      // fecha_compromiso ya pasada) tiene creación > compromiso; sin esto, la
      // ventana quedaba invertida y la tarea desaparecía en silencio del
      // reporte. Un reporte ejecutivo no puede perder datos por una
      // combinación de fechas atípica pero real.
      var kIni = kCreacion < kCompromiso ? kCreacion : kCompromiso;
      var kFin = kCreacion < kCompromiso ? kCompromiso : kCreacion;
      return kIni <= sem.hasta && kFin >= sem.desde;
    }).sort(function (a, b) {
      var pa = (a.es_critica ? 0 : 2) + (a.semaforo === 'atrasada' ? 0 : 1);
      var pb = (b.es_critica ? 0 : 2) + (b.semaforo === 'atrasada' ? 0 : 1);
      if (pa !== pb) return pa - pb;
      return new Date(a.fecha_compromiso) - new Date(b.fecha_compromiso);
    });
    if (!tareasSemana.length && !hitosSemana.length) return '';

    var extra = tareasSemana.length - MINI_GANTT_TOPE_TAREAS_;
    var chips = tareasSemana.slice(0, MINI_GANTT_TOPE_TAREAS_).map(function (a) {
      var color = GANTT_SEMAFORO_SOLIDO_[a.semaforo] || '#64748B';
      var plan = planPorTarea[a.actividad_id];
      var flechaDesv = (plan && plan.desviacion_pp !== null && plan.desviacion_pp !== undefined)
        ? (plan.desviacion_pp < 0 ? ' &#9660;' : ' &#9650;') : '';
      var criticaTag = a.es_critica ? ' &#9733;' : '';
      var titulo = a.titulo.length > 30 ? a.titulo.slice(0, 29) + '…' : a.titulo;
      return '<span style="display:inline-block;background-color:' + color + ';color:#ffffff;font-size:9px;' +
        'font-weight:bold;padding:3px 7px;border-radius:3px;margin:2px 4px 2px 0;white-space:nowrap;">' +
        escaparHtml_(titulo) + criticaTag + flechaDesv + '</span>';
    }).join('');
    var masTxt = extra > 0 ? '<span style="font-size:9px;color:' + DOC.MUTED + ';">+' + extra + ' más</span>' : '';
    var hitosTxt = hitosSemana.length
      ? '<div style="margin-top:5px;font-size:10px;color:' + DOC.NAVY + ';font-weight:bold;">&#9670; ' +
          escaparHtml_(hitosSemana.map(function (h) { return h.nombre; }).join(' · ')) + '</div>'
      : '';
    return '<div style="border:1px solid ' + DOC.HAIRLINE + ';border-radius:4px;padding:8px 10px;margin-bottom:7px;">' +
      '<div style="font-size:10px;font-weight:bold;color:' + DOC.MUTED + ';text-transform:uppercase;letter-spacing:0.3px;margin-bottom:5px;">' +
        'Semana del ' + fechaCortaPdfProyecto_(sem.desde) + ' al ' + fechaCortaPdfProyecto_(sem.hasta) + '</div>' +
      '<div>' + chips + masTxt + '</div>' + hitosTxt +
    '</div>';
  }).join('');
  if (!bloques) return '';
  return docSeccionOt_('Plan de ejecución -- semana a semana') +
    '<div style="margin:0 0 6px;">' + bloques + '</div>' +
    '<div style="font-size:9px;color:' + DOC.MUTED + ';margin:0 0 18px;">&#9733; en la ruta crítica &nbsp;·&nbsp; &#9650; avance sobre lo esperado &nbsp;·&nbsp; &#9660; avance bajo lo esperado</div>';
}

function construirHtmlReporteProyecto_(detalle, tareas, rendimiento, bitacoraReciente, tareasPorId) {
  var hoyClave = clavePdf_(new Date());
  var semanas = construirSemanasReportePdf_(tareas || [], null, hoyClave);
  var cuerpo = fichaProyectoPdf_(detalle) +
    seccionNarrativaPdf_(detalle) +
    seccionMiniGanttSemanalPdf_(tareas, detalle.hitos || [], rendimiento, semanas) +
    seccionHitosPdf_(detalle.hitos || []) +
    seccionRiesgosPdf_(detalle.riesgos || []) +
    seccionVencimientosPdf_(tareas || []) +
    seccionRendimientoPdf_(rendimiento) +
    seccionBitacoraPdf_(bitacoraReciente || [], tareasPorId || {});
  var p = detalle.proyecto;
  return docChromeOt_({ tipoDoc: 'Reporte de proyecto', referencia: p.codigo || p.nombre }, cuerpo);
}

// --- reporte PDF configurable (v11, "PDF ejecutivo configurable") --------
//
// Decisión de diseño: `construirHtmlReporteProyecto_` (arriba) queda 100%
// intacta -- es el camino de un clic, sin configurar, y no debía cambiar en
// una coma. Todo lo nuevo vive en funciones aparte que SOLO se llaman cuando
// el usuario abrió "Configurar informe" y envió una config explícita.

// Secciones disponibles, en el ORDEN fijo en que aparecen en el documento
// (el usuario elige subconjunto, no reordena). Hitos/Riesgos son del
// proyecto completo -- no tienen "responsable" que filtrar como Gantt/
// Workload/Desviaciones/Vencimientos sí tienen.
// v13 (Fase 3): 'narrativa' (Resumen ejecutivo en prosa) y 'mini_gantt'
// (plan semana a semana) se suman en el orden en que deben LEERSE -- justo
// después de portada/ficha y antes del detalle de hitos, para que cuenten
// la historia ANTES de las tablas (§9 del encargo).
var REPORTE_SECCIONES_DISPONIBLES_ = [
  'portada', 'narrativa', 'ficha', 'kpis', 'salud', 'mini_gantt', 'hitos', 'riesgos',
  'vencimientos', 'rendimiento', 'desviaciones', 'gantt', 'workload', 'bitacora', 'leyenda'
];

// Valida/normaliza la config que llega del frontend. null = "no hay config"
// (el caller usa el camino clásico); nunca deja pasar un array/rango con
// forma inesperada -- una config corrupta no debe tumbar la generación del
// PDF, solo caer a valores seguros.
function normalizarConfigReporte_(config) {
  if (!config) return null;
  var secciones = Array.isArray(config.secciones)
    ? config.secciones.filter(function (s) { return REPORTE_SECCIONES_DISPONIBLES_.indexOf(s) !== -1; })
    : [];
  if (!secciones.length) secciones = ['ficha']; // nunca un PDF vacío
  var personas = Array.isArray(config.personas)
    ? config.personas.map(normalizarEmailProyecto_).filter(Boolean)
    : [];
  var estado = ['abiertas', 'atrasadas'].indexOf(config.estado) !== -1 ? config.estado : '';
  var rango = null;
  if (config.rango && /^\d{4}-\d{2}-\d{2}$/.test(config.rango.desde || '') &&
      /^\d{4}-\d{2}-\d{2}$/.test(config.rango.hasta || '') && config.rango.desde <= config.rango.hasta) {
    rango = { desde: config.rango.desde, hasta: config.rango.hasta };
  }
  return { secciones: secciones, personas: personas, estado: estado, rango: rango };
}

// 'YYYY-MM-DD' <-> Date, en UTC -- mismo criterio que ya usa obtenerRendimiento
// para las claves de día (f.toISOString().slice(0,10)), para que un
// REGISTRO_DIA (que guarda 'dia' como string plano) y un check-in (que solo
// tiene 'timestamp') caigan en la MISMA clave sin desfases de huso horario.
function clavePdf_(f) { return f.toISOString().slice(0, 10); }
function fechaDeClavePdf_(c) { var p = String(c).split('-').map(Number); return new Date(Date.UTC(p[0], p[1] - 1, p[2])); }
function redond1Pdf_(n) { return Math.round(n * 10) / 10; }

// Días que cubre el Gantt/Workload del reporte: el rango explícito si el
// usuario lo dio, o el tramo real del proyecto (desde la tarea más antigua
// hasta la más lejana o hoy) si no -- tope de 60 días: un PDF más largo se
// vuelve impracticable, y quien necesita más detalle puede pedir un rango
// puntual desde "Configurar informe".
var REPORTE_LIMITE_DIAS_GANTT_ = 60;
function construirDiasReportePdf_(tareas, rango, hoyClave) {
  var desde, hasta;
  if (rango) {
    desde = rango.desde; hasta = rango.hasta;
  } else {
    var claves = [hoyClave];
    tareas.forEach(function (a) {
      if (a.fecha_creacion) claves.push(clavePdf_(new Date(a.fecha_creacion)));
      if (a.fecha_compromiso) claves.push(clavePdf_(new Date(a.fecha_compromiso)));
    });
    claves.sort();
    desde = claves[0]; hasta = claves[claves.length - 1];
  }
  var dias = [], cursor = fechaDeClavePdf_(desde), fin = fechaDeClavePdf_(hasta);
  while (cursor.getTime() <= fin.getTime() && dias.length < REPORTE_LIMITE_DIAS_GANTT_) {
    dias.push(clavePdf_(cursor));
    cursor = new Date(cursor.getTime() + 24 * 3600 * 1000);
  }
  return dias;
}

// v11: el motor HTML->PDF de Apps Script SÍ respeta @page si va en el <head>
// del blob -- una vez que el informe trae Gantt/Workload (muchas columnas de
// día), portrait ya no alcanza. Los cortes (18/30/45 días) son los MISMOS
// que usa el chunking de las tablas (ver seccionGanttPdf_/seccionWorkloadPdf_
// más abajo): cada página del PDF trae exactamente las columnas que le caben
// a su tamaño. No hay forma de probar la geometría real en el sandbox de
// tests (no tiene motor de PDF) -- se verifica leyendo el HTML generado.
function paginaCssParaDias_(totalDias) {
  var tamano = totalDias <= 18 ? 'A4' : (totalDias <= 30 ? 'A3' : 'A2');
  return '@page { size: ' + tamano + ' landscape; margin: 1.2cm; }';
}

// Mismo chrome visual que docChromeOt_ (OrdenTrabajo.gs), pero con su propio
// <head> para poder inyectar el <style>@page> de arriba -- deliberadamente
// NO se toca docChromeOt_ (lo usan tambien la Orden de Trabajo y el reporte
// de Pausas; cambiar su firma es un riesgo que no vale la pena para este
// reporte). Duplicar este bloque es el mismo criterio ya aplicado en otras
// fases: frontend/backend (y aquí, reporte "clásico" vs "configurado") son
// caminos separados que no vale la pena forzar a compartir función.
function docChromeProyectoPdf_(meta, contenidoHtml, paginaCss) {
  var emitida = formatearFechaLegible_(new Date());
  return '<!DOCTYPE html><html><head><meta charset="utf-8">' +
    (paginaCss ? '<style>' + paginaCss + '</style>' : '') +
    '</head>' +
    '<body style="margin:0;font-family:' + DOC.SANS + ';color:' + DOC.INK + ';font-size:13px;line-height:1.5;">' +
    '<div style="padding:26px 30px;">' +
    '<table width="100%" style="border-collapse:collapse;"><tr>' +
    '<td style="vertical-align:middle;">' +
    '<table style="border-collapse:collapse;"><tr>' +
    '<td style="background:' + DOC.NAVY + ';color:#ffffff;font-family:' + DOC.SERIF + ';font-weight:bold;font-size:18px;' +
    'width:30px;height:30px;text-align:center;vertical-align:middle;border-radius:5px;">S</td>' +
    '<td style="padding-left:10px;vertical-align:middle;">' +
    '<div style="font-size:17px;font-weight:bold;letter-spacing:2px;color:' + DOC.INK + ';">SIGSO</div>' +
    '<div style="font-size:10px;color:' + DOC.MUTED + ';letter-spacing:0.3px;">Sistema de Gestión de Solicitudes</div>' +
    '</td></tr></table>' +
    '</td>' +
    '<td style="vertical-align:middle;text-align:right;">' +
    '<div style="font-size:12px;letter-spacing:2px;color:' + DOC.NAVY + ';font-weight:bold;text-transform:uppercase;">' +
    escaparHtml_(meta.tipoDoc) + '</div>' +
    '<div style="font-size:14px;color:' + DOC.INK + ';font-weight:bold;margin-top:2px;">N.º ' + escaparHtml_(meta.referencia) + '</div>' +
    '<div style="font-size:10px;color:' + DOC.MUTED + ';margin-top:2px;">Emitida: ' + escaparHtml_(emitida) + '</div>' +
    '</td></tr></table>' +
    '<div style="border-top:2px solid ' + DOC.NAVY + ';margin-top:12px;"></div>' +
    '<div style="border-top:1px solid ' + DOC.HAIRLINE + ';margin-top:2px;margin-bottom:18px;"></div>' +
    contenidoHtml +
    '<div style="border-top:1px solid ' + DOC.HAIRLINE + ';margin-top:22px;padding-top:10px;font-size:10px;color:' + DOC.FAINT + ';line-height:1.5;">' +
    'SIGSO · Sistema de Gestión de Solicitudes · Documento generado automáticamente el ' + escaparHtml_(emitida) + '.<br>' +
    '<strong style="color:' + DOC.MUTED + ';">Confidencial — uso interno.</strong> Contiene datos de acceso y de la operación; no lo redistribuyas fuera del equipo autorizado.' +
    '</div>' +
    '</div></body></html>';
}

// Arma el HTML completo del reporte configurado: filtra tareas por persona/
// estado, calcula (si hace falta) los días del Gantt/Workload y arma solo
// las secciones que el usuario eligió, en el orden fijo de
// REPORTE_SECCIONES_DISPONIBLES_.
function construirHtmlReporteConfigurado_(detalle, todasTareas, rendimiento, tareasPorId, config, contexto) {
  function incluye(s) { return config.secciones.indexOf(s) !== -1; }

  var tareasFiltradas = todasTareas.filter(function (a) {
    if (config.personas.length && config.personas.indexOf(normalizarEmailProyecto_(a.responsable_email)) === -1) return false;
    if (config.estado === 'abiertas' && (a.estado === 'TERMINADA' || a.estado === 'CANCELADA')) return false;
    if (config.estado === 'atrasadas' && a.semaforo !== 'atrasada') return false;
    return true;
  });

  var necesitaDias = incluye('gantt') || incluye('workload');
  var hoyClave = clavePdf_(new Date());
  var dias = necesitaDias ? construirDiasReportePdf_(tareasFiltradas, config.rango, hoyClave) : [];
  // v13 (Fase 3): las semanas del mini-Gantt son independientes del día×día
  // de 'gantt'/'workload' -- misma fuente (fechas de tareasFiltradas) pero
  // agrupada distinto, y sin costo si no se pidió.
  var semanas = incluye('mini_gantt') ? construirSemanasReportePdf_(tareasFiltradas, config.rango, hoyClave) : [];

  // Bitácora de las tareas filtradas, partida en registroPorTareaDia (P0,
  // manda sobre lo derivado del check-in) y eventosPorTareaDia (el resto) --
  // MISMA estructura y prioridad que usa la carta en pantalla
  // (pintarCronogramaDedicacion_), solo que aquí alimenta tablas de PDF.
  var registroPorTareaDia = {}, eventosPorTareaDia = {}, bitacoraCompleta = [];
  if (necesitaDias || incluye('bitacora')) {
    var idsFiltrados = {};
    tareasFiltradas.forEach(function (a) { idsFiltrados[a.actividad_id] = true; });
    bitacoraCompleta = Proyectos.listarBitacora({ proyecto_id: detalle.proyecto.proyecto_id }, contexto)
      .filter(function (b) { return idsFiltrados[b.actividad_id]; });
    bitacoraCompleta.forEach(function (b) {
      var k = (b.tipo === 'REGISTRO_DIA' && b.dia) ? b.dia : (b.timestamp ? clavePdf_(new Date(b.timestamp)) : '');
      if (!k) return;
      if (b.tipo === 'REGISTRO_DIA') {
        (registroPorTareaDia[b.actividad_id] = registroPorTareaDia[b.actividad_id] || {})[k] = b;
      } else {
        var porDia = (eventosPorTareaDia[b.actividad_id] = eventosPorTareaDia[b.actividad_id] || {});
        (porDia[k] = porDia[k] || []).push(b);
      }
    });
  }

  var partes = [];
  if (incluye('portada')) partes.push(seccionPortadaPdf_(detalle));
  if (incluye('narrativa')) partes.push(seccionNarrativaPdf_(detalle));
  if (incluye('ficha')) partes.push(fichaProyectoPdf_(detalle));
  if (incluye('kpis')) partes.push(bandaKpisPdf_(detalle, rendimiento));
  if (incluye('salud')) partes.push(seccionSaludPdf_(detalle));
  if (incluye('mini_gantt')) partes.push(seccionMiniGanttSemanalPdf_(tareasFiltradas, detalle.hitos || [], rendimiento, semanas));
  if (incluye('hitos')) partes.push(seccionHitosPdf_(detalle.hitos || []));
  if (incluye('riesgos')) partes.push(seccionRiesgosPdf_(detalle.riesgos || []));
  if (incluye('vencimientos')) partes.push(seccionVencimientosPdf_(tareasFiltradas));
  if (incluye('rendimiento')) partes.push(seccionRendimientoPdf_(rendimiento));
  if (incluye('desviaciones')) partes.push(seccionDesviacionesPdf_(rendimiento, tareasFiltradas, tareasPorId));
  if (incluye('gantt')) partes.push(seccionGanttPdf_(tareasFiltradas, dias, registroPorTareaDia, eventosPorTareaDia));
  if (incluye('workload')) partes.push(seccionWorkloadPdf_(tareasFiltradas, dias, registroPorTareaDia, eventosPorTareaDia));
  if (incluye('bitacora')) {
    // v11: "la bitácora del día es la fuente, no una captura" -- si hay un
    // rango (explícito o el que ya calculó el Gantt/Workload), la sección
    // muestra TODO lo que pasó en esa ventana, en orden cronológico; sin
    // rango, se queda en las últimas 30 (el doble que el reporte clásico,
    // porque este SÍ es un informe a medida, no el de un clic).
    var rangoEfectivo = dias.length ? { desde: dias[0], hasta: dias[dias.length - 1] } : config.rango;
    var bitacoraSeccion;
    if (rangoEfectivo) {
      bitacoraSeccion = bitacoraCompleta.filter(function (b) {
        var k = (b.tipo === 'REGISTRO_DIA' && b.dia) ? b.dia : (b.timestamp ? clavePdf_(new Date(b.timestamp)) : '');
        return k >= rangoEfectivo.desde && k <= rangoEfectivo.hasta;
      }).sort(function (a, b) { return new Date(a.timestamp) - new Date(b.timestamp); });
    } else {
      bitacoraSeccion = bitacoraCompleta.slice(-30).reverse();
    }
    partes.push(seccionBitacoraPdf_(bitacoraSeccion, tareasPorId));
  }
  if (incluye('leyenda')) partes.push(seccionLeyendaPdf_());

  var p = detalle.proyecto;
  var paginaCss = necesitaDias ? paginaCssParaDias_(dias.length) : '';
  return docChromeProyectoPdf_({ tipoDoc: 'Reporte de proyecto', referencia: p.codigo || p.nombre }, partes.join(''), paginaCss);
}

// --- portada / salud detallada / desviaciones / Gantt / workload / leyenda

function seccionPortadaPdf_(detalle) {
  var p = detalle.proyecto;
  var scoreTxt = detalle.salud_penalizacion ? ' · ' + detalle.salud_penalizacion + ' pts en contra' : '';
  return '<div style="padding:60px 0 40px;text-align:center;page-break-after:always;">' +
    '<div style="font-size:11px;letter-spacing:2px;text-transform:uppercase;color:' + DOC.MUTED + ';margin-bottom:10px;">Reporte ejecutivo de proyecto</div>' +
    '<div style="font-size:26px;font-weight:bold;font-family:' + DOC.SERIF + ';color:' + DOC.INK + ';margin-bottom:14px;">' + escaparHtml_(p.nombre) + '</div>' +
    '<div style="margin-bottom:24px;">' +
      saludChipPdf_(detalle.salud, (PROYECTOS_SALUD_LABEL_PDF[detalle.salud] || detalle.salud) + scoreTxt) + '</div>' +
    '<table style="margin:0 auto;border-collapse:collapse;font-size:12px;">' +
      '<tr><td style="' + celdaLabelFicha_() + '">Código</td><td style="' + celdaValorFicha_() + '">' + escaparHtml_(p.codigo || '—') + '</td></tr>' +
      '<tr><td style="' + celdaLabelFicha_() + '">Líder</td><td style="' + celdaValorFicha_() + '">' + escaparHtml_(p.lider_email || '—') + '</td></tr>' +
      '<tr><td style="' + celdaLabelFicha_() + '">Período</td><td style="' + celdaValorFicha_() + '">' + fechaCortaPdfProyecto_(p.fecha_inicio) + ' – ' + fechaCortaPdfProyecto_(p.fecha_objetivo) + '</td></tr>' +
    '</table>' +
    '</div>';
}

// v12 ("reporte PDF potenciado"): banda de KPIs ejecutivos -- una fila de
// tarjetas con el número grande y su etiqueta, para que quien abre el PDF
// entienda el estado del proyecto en tres segundos, antes de cualquier
// tabla. Los KPIs alarmantes (vencidas/bloqueadas/hitos atrasados) se
// pintan en rojo SOLO cuando su valor es > 0 -- un cero no debe gritar.
// Mismos números que la pestaña Resumen (requiere_atencion) y el
// rendimiento (Fase G3): cero cálculo nuevo, solo presentación.
function kpiTarjetaPdf_(valor, etiqueta, tono) {
  var color = tono === 'alerta' ? '#B91C1C' : (tono === 'ok' ? '#15803D' : DOC.INK);
  return '<td style="width:16.6%;border:1px solid ' + DOC.HAIRLINE + ';background:' + DOC.PANEL + ';' +
      'padding:9px 6px;text-align:center;vertical-align:middle;">' +
    '<div style="font-size:21px;font-weight:bold;font-family:' + DOC.SERIF + ';color:' + color + ';line-height:1.05;">' +
      escaparHtml_(String(valor)) + '</div>' +
    '<div style="font-size:8px;text-transform:uppercase;letter-spacing:0.5px;color:' + DOC.MUTED + ';margin-top:3px;">' +
      escaparHtml_(etiqueta) + '</div>' +
  '</td>';
}
function bandaKpisPdf_(detalle, rendimiento) {
  var at = detalle.requiere_atencion || {};
  var c = (rendimiento && rendimiento.cumplimiento_tareas) || {};
  var horas = (rendimiento && rendimiento.horas_totales_proyecto) || 0;
  var tarjetas = [
    kpiTarjetaPdf_(detalle.avance_pct === null || detalle.avance_pct === undefined ? '—' : detalle.avance_pct + '%', 'Avance'),
    kpiTarjetaPdf_(c.entregadas ? c.a_tiempo + '/' + c.entregadas : '—', 'Entregas a tiempo'),
    kpiTarjetaPdf_(horas ? redond1Pdf_(horas) + 'h' : '—', 'Horas registradas'),
    kpiTarjetaPdf_(at.tareas_vencidas || 0, 'Tareas vencidas', (at.tareas_vencidas > 0 ? 'alerta' : '')),
    kpiTarjetaPdf_(at.tareas_bloqueadas || 0, 'Bloqueadas', (at.tareas_bloqueadas > 0 ? 'alerta' : '')),
    kpiTarjetaPdf_(at.hitos_atrasados || 0, 'Hitos atrasados', (at.hitos_atrasados > 0 ? 'alerta' : ''))
  ];
  return docSeccionOt_('Indicadores clave') +
    '<table width="100%" style="border-collapse:collapse;margin:0 0 18px;"><tr>' + tarjetas.join('') + '</tr></table>';
}

// v11 (P1, "score de salud ponderado" -> aquí, en el PDF): el mismo score/
// desglose que ya se ve en pantalla, en forma de tabla -- cada factor con
// cuántos puntos restó, para que el número no sea una caja negra tampoco en
// el documento que gerencia reenvía.
var SALUD_FACTOR_LABEL_PDF_ = {
  hito_vencido: 'Hito(s) vencido(s)', tarea_critica_atrasada: 'Tarea(s) crítica(s) atrasada(s)',
  tarea_atrasada: 'Tarea(s) atrasada(s)', bloqueo_estancado: 'Bloqueo(s) estancado(s)',
  tarea_bloqueada: 'Tarea(s) bloqueada(s)', sin_actualizar: 'Tarea(s) sin actualizar',
  entregable_vencido: 'Entregable(s) vencido(s)', entregable_observado: 'Entregable(s) observado(s)'
};
function seccionSaludPdf_(detalle) {
  var scoreTxt = (detalle.salud_penalizacion === null || detalle.salud_penalizacion === undefined)
    ? 'Fijado manualmente'
    : (detalle.salud_penalizacion === 0 ? 'Sin factores en contra' : detalle.salud_penalizacion + ' puntos en contra');
  var cabecera = '<div style="margin:0 0 10px;">' +
    saludChipPdf_(detalle.salud, (PROYECTOS_SALUD_LABEL_PDF[detalle.salud] || detalle.salud) + ' · ' + scoreTxt) + '</div>';
  var filas = (detalle.salud_desglose || []).map(function (d) {
    return '<tr>' +
      '<td style="' + celdaValorFicha_() + '">' + escaparHtml_(SALUD_FACTOR_LABEL_PDF_[d.factor] || d.factor) + '</td>' +
      '<td style="' + celdaValorFicha_() + '">' + d.cantidad + '</td>' +
      '<td style="' + celdaValorFicha_() + '">-' + d.puntos + '</td>' +
    '</tr>';
  }).join('');
  if (!filas) return docSeccionOt_('Salud del proyecto') + cabecera;
  return docSeccionOt_('Salud del proyecto') + cabecera +
    '<table width="100%" style="border-collapse:collapse;border:1px solid ' + DOC.HAIRLINE + ';margin:0 0 18px;font-size:12px;">' + filas + '</table>';
}

// v11 (P1, "Plan · Esperado · Real" -> aquí, en el PDF): mismo dato que ya
// muestra la carta en pantalla bajo el título de cada tarea, en tabla.
function seccionDesviacionesPdf_(rendimiento, tareas, tareasPorId) {
  var plan = (rendimiento && rendimiento.plan_seguimiento) || [];
  var idsFiltrados = {};
  tareas.forEach(function (a) { idsFiltrados[a.actividad_id] = true; });
  var filasPlan = plan.filter(function (t) { return idsFiltrados[t.actividad_id] && t.plan_fin; });
  if (!filasPlan.length) return '';
  var filas = filasPlan.map(function (t) {
    var tarea = tareasPorId[t.actividad_id];
    var tieneDesv = !(t.desviacion_pp === null || t.desviacion_pp === undefined);
    var desvTxt = tieneDesv ? (t.desviacion_pp >= 0 ? '+' : '') + t.desviacion_pp + 'pp' : '—';
    var desvColor = tieneDesv ? colorDesviacionPdf_(t.desviacion_pp) : DOC.MUTED;
    return '<tr>' +
      '<td style="' + celdaValorFicha_() + '">' + escaparHtml_(tarea ? tarea.titulo : '—') + '</td>' +
      '<td style="' + celdaValorFicha_() + '">' + fechaCortaPdfProyecto_(t.plan_fin) + '</td>' +
      '<td style="' + celdaValorFicha_() + '">' + (t.avance_esperado_pct === null || t.avance_esperado_pct === undefined ? '—' : t.avance_esperado_pct + '%') + '</td>' +
      '<td style="' + celdaValorFicha_() + '">' + (t.avance_real_pct === null || t.avance_real_pct === undefined ? '—' : t.avance_real_pct + '%') + '</td>' +
      '<td style="' + celdaValorFicha_() + 'color:' + desvColor + ';font-weight:bold;">' + desvTxt + '</td>' +
    '</tr>';
  }).join('');
  return docSeccionOt_('Plan · Esperado · Real') +
    '<table width="100%" style="border-collapse:collapse;border:1px solid ' + DOC.HAIRLINE + ';margin:0 0 18px;font-size:12px;">' + filas + '</table>';
}

// v11 ("Gantt multipágina"): la letra de cada celda tarea×día, misma
// prioridad y misma derivación que ya usa la carta en pantalla
// (pintarCronogramaDedicacion_/filaTareaHtml_ en proyectos.js) -- un
// REGISTRO_DIA (P0) manda; si no hay, se deriva de los check-ins del día;
// si tampoco, "A" en el día de creación. Deliberadamente NO replica las
// marcas "esperando a un tercero"/"vencida sin gestión" de la pantalla (son
// matices de UX en vivo; un Gantt impreso que muestra fielmente lo
// REGISTRADO, y nada más, ya cumple "la bitácora es la fuente, no una
// caja negra" sin arrastrar esa complejidad al backend).
var GANTT_PDF_ESTADO_ = {
  asignado: { letra: 'A', bg: '#EDE9FE' }, planificado: { letra: 'P', bg: '#DBEAFE' },
  en_proceso: { letra: '●', bg: '#DBEAFE' }, bloqueado: { letra: '!', bg: '#FEE2E2' },
  pausado: { letra: '‖', bg: '#F1F5F9' }, finalizado: { letra: '✓', bg: '#DCFCE7' },
  entregado: { letra: 'F', bg: '#DCFCE7' }, revision: { letra: 'R', bg: '#FEF3C7' },
  esperando_tercero: { letra: '…', bg: '#F1F5F9' }
};
function celdaGanttPdf_(actividadId, diaClave, claveCreacion, registroPorTareaDia, eventosPorTareaDia) {
  var reg = (registroPorTareaDia[actividadId] || {})[diaClave];
  if (reg) {
    var vis = GANTT_PDF_ESTADO_[reg.estado_dia] || { letra: '•', bg: '#F1F5F9' };
    return { letra: vis.letra, bg: vis.bg };
  }
  // Allowlist EXACTA de DEDICACION_TIPO_ESTADO_ (proyectos.js) -- CREADA
  // (que también viaja en la bitácora) deliberadamente NO cuenta como "se
  // trabajó ese día": el día de creación se marca "A" comparando contra
  // fecha_creacion más abajo, no encontrando un evento CREADA.
  var eventos = (eventosPorTareaDia[actividadId] || {})[diaClave] || [];
  var letra = '', bg = '';
  eventos.forEach(function (ev) {
    if (ev.tipo === 'ENTREGA') { letra = 'F'; bg = '#DCFCE7'; return; }
    if (ev.tipo === 'VALIDACION') {
      if (/^Aprobada/i.test(ev.nota || '')) { letra = 'F'; bg = '#DCFCE7'; }
      else if (letra !== 'F') { letra = '!'; bg = '#FEE2E2'; }
      return;
    }
    if (letra === 'F') return;
    if (ev.tipo === 'BLOQUEO') { letra = '!'; bg = '#FEE2E2'; return; }
    if (['CHECKIN_AVANCE', 'CHECKIN_SIN_CAMBIO', 'DESBLOQUEO'].indexOf(ev.tipo) !== -1 && letra !== '!') {
      letra = 'P'; bg = '#DBEAFE';
    }
  });
  if (!letra && diaClave === claveCreacion) { letra = 'A'; bg = '#EDE9FE'; }
  return { letra: letra, bg: bg };
}

// Días por página según el tamaño que va a usar paginaCssParaDias_ (mismos
// cortes) -- así cada página del Gantt/Workload trae justo las columnas que
// le caben a su tamaño de papel, sin adivinar por separado en dos lugares.
function diasPorPaginaPdf_(totalDias) {
  return totalDias <= 18 ? 18 : (totalDias <= 30 ? 30 : 45);
}

// v12 ("reporte PDF potenciado"): la Carta Gantt deja de ser una grilla de
// letras sueltas y pasa a dibujar una BARRA real por tarea. El período
// planificado (de la creación a la fecha comprometida) se pinta como una
// banda continua; los días CON actividad registrada llevan el color de SU
// estado (más informativo que un color plano de barra); el atraso sin cerrar
// va en rojo oscuro más allá del compromiso hasta hoy; la columna de HOY
// lleva una línea azul. Sigue siendo una tabla (100% robusta en el motor
// HTML->PDF de Apps Script, sin posicionamiento absoluto).
//
// v12.1 ("color sobretodo"): el motor HTML->PDF de Apps Script rinde los
// fondos MUY pálidos casi como blanco -- en el PDF real la Carta Gantt salía
// sin color. Se pasa a colores SÓLIDOS y SATURADOS (mismos que el semáforo en
// pantalla) con la letra en BLANCO encima, para que se diferencie de un
// vistazo. Nada de gradientes (el motor no los soporta).
var GANTT_SEMAFORO_SOLIDO_ = {
  'al-dia': '#16A34A', 'terminada': '#16A34A', 'riesgo': '#D97706',
  'atrasada': '#DC2626', 'bloqueada': '#2563EB', 'pendiente': '#64748B',
  'cancelada': '#94A3B8', 'revision': '#7C3AED'
};
var GANTT_ATRASO_SOLIDO_ = '#B91C1C';       // tramo vencido: rojo más oscuro que la barra
// Color por LETRA de la marca del día (lo registrado ese día manda sobre el
// color de barra) -- coherente con GANTT_SEMAFORO_SOLIDO_.
function ganttColorMarcaPdf_(letra) {
  if (letra === 'F' || letra === '✓') return '#16A34A';   // entregado / finalizado
  if (letra === '!') return '#DC2626';                     // bloqueado
  if (letra === 'R') return '#D97706';                     // en revisión
  if (letra === 'A') return '#7C3AED';                     // asignado
  if (letra === '‖' || letra === '…') return '#64748B';    // pausa / esperando
  return '#2563EB';                                        // P / ● (en proceso / se trabajó)
}
function ganttDiaCortoPdf_(clave) { var p = String(clave).split('-'); return p[2] + '/' + p[1]; }

// Chip de color para la leyenda del semáforo de la Carta Gantt.
function ganttChipLeyendaPdf_(color, texto) {
  return '<span style="display:inline-block;background-color:' + color + ';color:#ffffff;font-weight:bold;' +
    'font-size:8px;padding:2px 7px;border-radius:3px;margin-right:5px;">' + escaparHtml_(texto) + '</span>';
}

function seccionGanttPdf_(tareas, dias, registroPorTareaDia, eventosPorTareaDia) {
  if (!tareas.length || !dias.length) return '';
  var hoyClave = clavePdf_(new Date());
  var chunk = diasPorPaginaPdf_(dias.length);
  var paginas = [];
  for (var i = 0; i < dias.length; i += chunk) paginas.push(dias.slice(i, i + chunk));

  var html = paginas.map(function (diasPagina, idx) {
    var encabezado = '<tr><td style="padding:5px 8px;width:22%;background-color:' + DOC.NAVY + ';color:#ffffff;' +
        'font-size:9px;font-weight:bold;text-transform:uppercase;letter-spacing:0.5px;border:1px solid ' + DOC.NAVY + ';">Tarea</td>' +
      diasPagina.map(function (d) {
        var esHoy = d === hoyClave;
        return '<td style="padding:4px 1px;text-align:center;font-size:8px;line-height:1.15;font-weight:bold;' +
          'border:1px solid ' + DOC.NAVY + ';background-color:' + (esHoy ? '#2563EB' : DOC.NAVY) + ';color:#ffffff;">' +
          ganttDiaCortoPdf_(d) + '</td>';
      }).join('') + '</tr>';
    var filas = tareas.map(function (a) {
      var claveCreacion = a.fecha_creacion ? clavePdf_(new Date(a.fecha_creacion)) : '';
      var claveCommit = a.fecha_compromiso ? clavePdf_(new Date(a.fecha_compromiso)) : '';
      var claveInicioPlan = claveCreacion || claveCommit;
      var sem = a.semaforo || 'al-dia';
      var bgBarra = GANTT_SEMAFORO_SOLIDO_[sem] || '#64748B';
      var terminal = (a.estado === 'TERMINADA' || a.estado === 'CANCELADA');
      var celdas = diasPagina.map(function (d) {
        var c = celdaGanttPdf_(a.actividad_id, d, claveCreacion, registroPorTareaDia, eventosPorTareaDia);
        var enPlan = claveInicioPlan && claveCommit && d >= claveInicioPlan && d <= claveCommit;
        var enAtraso = !terminal && claveCommit && d > claveCommit && d <= hoyClave;
        var esHoy = d === hoyClave;
        // Prioridad de color (sólido, saturado): lo registrado ese día > barra
        // planificada > tramo de atraso. La letra va en BLANCO sobre color.
        var bg = '';
        if (c.letra) bg = ganttColorMarcaPdf_(c.letra);
        else if (enPlan) bg = bgBarra;
        else if (enAtraso) bg = GANTT_ATRASO_SOLIDO_;
        var colorLetra = bg ? '#ffffff' : DOC.INK_SOFT;
        var borde = esHoy ? 'border-left:2px solid #2563EB;' : '';
        return '<td style="padding:6px 1px;text-align:center;font-size:9px;font-weight:bold;color:' + colorLetra + ';' +
          'border:1px solid ' + DOC.HAIRLINE + ';' + (bg ? 'background-color:' + bg + ';' : '') + borde + '">' + (c.letra || '') + '</td>';
      }).join('');
      var meta = escaparHtml_(a.responsable_nombre || a.responsable_email || '—') +
        (claveCommit ? ' · compromiso ' + fechaCortaPdfProyecto_(a.fecha_compromiso) : '');
      var etiqueta = '<div style="font-weight:bold;color:' + DOC.INK + ';font-size:10px;">' + escaparHtml_(a.titulo) + '</div>' +
        '<div style="font-size:8px;color:' + DOC.MUTED + ';margin-top:1px;">' + meta + '</div>';
      return '<tr><td style="padding:5px 8px;border:1px solid ' + DOC.HAIRLINE + ';vertical-align:middle;">' + etiqueta + '</td>' + celdas + '</tr>';
    }).join('');
    return '<table width="100%" style="border-collapse:collapse;border:1px solid ' + DOC.HAIRLINE + ';margin:0 0 14px;table-layout:fixed;' +
      (idx > 0 ? 'page-break-before:always;' : '') + '"><thead>' + encabezado + '</thead><tbody>' + filas + '</tbody></table>';
  }).join('');
  var leyendaColores =
    ganttChipLeyendaPdf_('#16A34A', 'Al día / entregado') +
    ganttChipLeyendaPdf_('#D97706', 'En riesgo / revisión') +
    ganttChipLeyendaPdf_('#DC2626', 'Atrasada / bloqueada') +
    ganttChipLeyendaPdf_('#2563EB', 'En proceso / hoy') +
    ganttChipLeyendaPdf_('#64748B', 'Pendiente / pausa');
  return docSeccionOt_('Carta Gantt') +
    '<div style="margin:0 0 8px;">' + leyendaColores + '</div>' +
    '<div style="font-size:9px;color:' + DOC.MUTED + ';margin:0 0 8px;line-height:1.5;">' +
      'Cada barra es el período planificado de la tarea (de su creación a la fecha comprometida), coloreada según su estado. ' +
      'Cada celda con letra es lo registrado ese día (ver Leyenda de letras abajo); el tramo rojo oscuro marca el atraso sin cerrar.' +
    '</div>' + html;
}

// v11 (P1, "workload heatmap" -> aquí, en el PDF): mismo total por persona/
// día que ya muestra "Por persona" en pantalla, en tabla, con la misma
// jornada de referencia (CUMPLIMIENTO_HORAS_JORNADA, Cumplimiento.gs) para
// marcar sobrecarga.
function seccionWorkloadPdf_(tareas, dias, registroPorTareaDia, eventosPorTareaDia) {
  if (!tareas.length || !dias.length) return '';
  var porPersona = {}, orden = [];
  tareas.forEach(function (a) {
    var clave = a.responsable_nombre || a.responsable_email || '—';
    if (!porPersona[clave]) { porPersona[clave] = []; orden.push(clave); }
    porPersona[clave].push(a);
  });
  function horasDelDia_(actividadId, diaClave) {
    var reg = (registroPorTareaDia[actividadId] || {})[diaClave];
    if (reg) return Number(reg.horas) || 0;
    var eventos = (eventosPorTareaDia[actividadId] || {})[diaClave] || [];
    return eventos.reduce(function (s, ev) { return s + (Number(ev.horas) || 0); }, 0);
  }
  var chunk = diasPorPaginaPdf_(dias.length);
  var paginas = [];
  for (var i = 0; i < dias.length; i += chunk) paginas.push(dias.slice(i, i + chunk));

  var html = paginas.map(function (diasPagina, idx) {
    var encabezado = '<tr><td style="' + celdaLabelFicha_() + 'width:auto;">Persona</td>' +
      diasPagina.map(function (d) { return '<td style="' + celdaLabelFicha_() + 'width:auto;text-align:center;">' + fechaCortaPdfProyecto_(d) + '</td>'; }).join('') + '</tr>';
    var filas = orden.map(function (persona) {
      var celdas = diasPagina.map(function (d) {
        var total = porPersona[persona].reduce(function (s, a) { return s + horasDelDia_(a.actividad_id, d); }, 0);
        var sobrecarga = total > CUMPLIMIENTO_HORAS_JORNADA;
        return '<td style="' + celdaValorFicha_() + 'width:auto;text-align:center;' +
          (sobrecarga ? 'background:#FEE2E2;font-weight:bold;color:#B91C1C;' : '') + '">' + (total ? redond1Pdf_(total) : '') + '</td>';
      }).join('');
      return '<tr><td style="' + celdaValorFicha_() + 'width:auto;">' + escaparHtml_(persona) + '</td>' + celdas + '</tr>';
    }).join('');
    return '<table width="100%" style="border-collapse:collapse;border:1px solid ' + DOC.HAIRLINE + ';margin:0 0 18px;font-size:10px;' +
      (idx > 0 ? 'page-break-before:always;' : '') + '">' + encabezado + filas + '</table>';
  }).join('');
  return docSeccionOt_('Carga de trabajo (horas por día y persona)') + html;
}

function seccionLeyendaPdf_() {
  var items = [
    ['A', 'Asignado'], ['P', 'Planificado / se trabajó'], ['●', 'En proceso'],
    ['✓ / F', 'Finalizado / entregado'], ['R', 'En revisión'], ['‖', 'En pausa'],
    ['…', 'Esperando a un tercero'], ['!', 'Bloqueado']
  ];
  var filas = items.map(function (i) {
    return '<tr><td style="' + celdaLabelFicha_() + 'width:10%;text-align:center;">' + i[0] + '</td>' +
      '<td style="' + celdaValorFicha_() + '">' + i[1] + '</td></tr>';
  }).join('');
  return docSeccionOt_('Leyenda') +
    '<table width="100%" style="border-collapse:collapse;border:1px solid ' + DOC.HAIRLINE + ';margin:0 0 18px;font-size:11px;">' + filas + '</table>';
}

function fichaProyectoPdf_(detalle) {
  var p = detalle.proyecto;
  var filas = [
    ['Líder', escaparHtml_(p.lider_email || '—'), 'Estado', escaparHtml_(PROYECTOS_ESTADO_LABEL_PDF[p.estado] || p.estado)],
    ['Salud', saludChipPdf_(detalle.salud, PROYECTOS_SALUD_LABEL_PDF[detalle.salud] || detalle.salud), 'Avance', (detalle.avance_pct === null ? '—' : detalle.avance_pct + '%')],
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
  DESBLOQUEO: 'Se destrabó', BLOQUEO: 'Bloqueada', ENTREGA: 'Entregada', VALIDACION: 'Revisión',
  REGISTRO_DIA: 'Registro del día' // v11 (P0)
};
var REGISTRO_DIA_ESTADO_LABEL_PDF_ = {
  asignado: 'Asignado', planificado: 'Planificado', en_proceso: 'En proceso',
  bloqueado: 'Bloqueado', pausado: 'En pausa', finalizado: 'Finalizado',
  entregado: 'Entregado', revision: 'En revisión', esperando_tercero: 'Esperando a un tercero'
};
function seccionBitacoraPdf_(bitacora, tareasPorId) {
  if (!bitacora.length) return '';
  var filas = bitacora.map(function (b) {
    var tarea = tareasPorId[b.actividad_id];
    // v11 (P0): las filas ya vienen normalizadas por filaBitacoraSalida_
    // (listarBitacora), así que un REGISTRO_DIA trae estado_dia/horas directos.
    var etiqueta = (b.tipo === 'REGISTRO_DIA')
      ? (REGISTRO_DIA_ESTADO_LABEL_PDF_[b.estado_dia] || 'Registro del día')
      : (BITACORA_TIPO_LABEL_PDF_[b.tipo] || b.tipo);
    return '<tr>' +
      '<td style="' + celdaValorFicha_() + '">' + fechaCortaPdfProyecto_(b.timestamp) + '</td>' +
      '<td style="' + celdaValorFicha_() + '">' + escaparHtml_(tarea ? tarea.titulo : '—') + '</td>' +
      '<td style="' + celdaValorFicha_() + '">' + escaparHtml_(etiqueta) + (b.horas ? ' (' + b.horas + 'h)' : '') +
        (b.nota ? ': ' + escaparHtml_(b.nota) : '') + '</td>' +
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
// Un proyecto no puede terminar antes de empezar. Devuelve el error de
// validacion o null. Fechas iguales se aceptan: un proyecto de un solo dia
// es legitimo.
function errorFechasProyecto_(inicio, objetivo) {
  if (!inicio || !objetivo) return null;
  var i = new Date(inicio), o = new Date(objetivo);
  if (isNaN(i.getTime()) || isNaN(o.getTime())) return null;  // otras validaciones se ocupan
  if (o < i) {
    return errorValidacion_('fecha_objetivo',
      'La fecha objetivo no puede ser anterior a la fecha de inicio.');
  }
  return null;
}

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
  var d = datosDeBitacora_(fila);
  return (d && d.horas !== undefined) ? d.horas : undefined;
}

// v11 (Reingeniería Cronograma, P0): un solo lugar donde se parsea el JSON
// libre 'datos' de ACTIVIDADES_BITACORA. Devuelve {} si no hay datos o si
// están corruptos -- nunca lanza, para que una fila vieja no tumbe la lectura
// de toda la bitácora.
function datosDeBitacora_(fila) {
  if (!fila || !fila.datos) return {};
  try {
    var d = JSON.parse(fila.datos);
    return (d && typeof d === 'object') ? d : {};
  } catch (e) {
    return {}; // dato viejo o corrupto: se ignora
  }
}

// v11 (P0): los 9 estados-del-día del registro diario. Son el ESTADO DEL DÍA
// (qué pasó ese día en esa tarea), distinto del estado de la tarea completa
// (ACTIVIDADES.estado). SIGSO no es vigilancia: "sin registro" no es un
// estado -- significa "SIGSO no tiene registro de ese día", nunca "no se
// trabajó". Por eso no existe un estado "no_trabajo".
var REGISTRO_DIA_ESTADOS_ = [
  'asignado',        // se asignó / quedó comprometida para ese día, aún sin avance
  'planificado',     // planificado para ese día (lo espero mover hoy)
  'en_proceso',      // se trabajó, avanza
  'bloqueado',       // frenado por algo (requiere motivo)
  'pausado',         // en pausa deliberada (no es bloqueo externo)
  'finalizado',      // terminado el trabajo del día
  'entregado',       // entregado ese día
  'revision',        // en revisión / validación
  'esperando_tercero' // esperando a alguien externo (cliente, proveedor, otra área)
];

// v11 (P0): normaliza una fila cruda de ACTIVIDADES_BITACORA a la forma que
// consume el frontend. Un REGISTRO_DIA (el registro editable de la celda
// diaria) trae además el estado-del-día explícito, el día al que pertenece,
// el motivo de bloqueo, los tramos horarios y la traza de edición (quién y
// cuándo lo tocó por última vez, y cuántas versiones lleva) -- así la Carta
// muestra "editado por X" sin exponer todo el historial en cada celda.
function filaBitacoraSalida_(b) {
  var d = datosDeBitacora_(b);
  var salida = {
    actividad_id: b.actividad_id,
    tipo: b.tipo,
    nota: b.nota,
    horas: (d.horas !== undefined) ? d.horas : undefined,
    timestamp: b.timestamp,
    autor_nombre: b.autor_nombre || b.autor_email,
    autor_email: b.autor_email
  };
  if (b.tipo === 'REGISTRO_DIA') {
    salida.dia = d.dia || '';
    salida.estado_dia = d.estado_dia || '';
    salida.bloqueo_motivo = d.bloqueo_motivo || '';
    salida.tramos = Array.isArray(d.tramos) ? d.tramos : [];
    salida.editado_por = d.editado_por || '';
    salida.editado_en = d.editado_en || '';
    salida.ediciones = Array.isArray(d.ediciones) ? d.ediciones.length : 0;
  }
  // v11 (P1, "historial antes→después"): REPROGRAMACION/REASIGNACION ya
  // guardan {fecha_anterior,fecha_nueva}/{responsable_anterior,
  // responsable_nuevo} en 'datos' desde Actividades.gs (reprogramar/
  // reasignar) -- solo hace falta exponerlos, cero cálculo nuevo.
  if (b.tipo === 'REPROGRAMACION') {
    salida.fecha_anterior = d.fecha_anterior || '';
    salida.fecha_nueva = d.fecha_nueva || '';
  }
  if (b.tipo === 'REASIGNACION') {
    salida.responsable_anterior = d.responsable_anterior || '';
    salida.responsable_nuevo = d.responsable_nuevo || '';
  }
  return salida;
}

// v11 (P1, "Esperado a hoy"): supuesto de avance LINEAL entre el inicio y el
// compromiso del plan -- el mismo supuesto simple, documentado y visible que
// usa el SPI de MS Project (no una predicción "inteligente"). Sin ambas
// fechas, o con el plan invertido/de un solo día, no hay curva que trazar:
// null, no un 0% que se leería como "no ha empezado nada".
function calcularAvanceEsperado_(fechaInicio, fechaFin, ahora) {
  if (!fechaInicio || !fechaFin) return null;
  var ini = new Date(fechaInicio), fin = new Date(fechaFin);
  if (isNaN(ini.getTime()) || isNaN(fin.getTime()) || fin <= ini) return null;
  var pct = ((ahora.getTime() - ini.getTime()) / (fin.getTime() - ini.getTime())) * 100;
  return Math.round(Math.max(0, Math.min(100, pct)) * 10) / 10;
}

// v11 (P1, "Real"): avance_pct explícito si existe (lo pone un checkin
// 'avance'); si no, solo se infiere en los dos estados donde el número es
// inequívoco (TERMINADA=100, NO_INICIADA=0) -- para EN_CURSO/BLOQUEADA sin
// avance_pct no se inventa un porcentaje (mismo criterio que
// calcularAvanceProyecto_: mejor "sin dato" que un número adivinado).
function avanceRealTarea_(a) {
  if (a.avance_pct !== undefined && a.avance_pct !== null && a.avance_pct !== '') return Number(a.avance_pct);
  if (a.estado === 'TERMINADA') return 100;
  if (a.estado === 'NO_INICIADA') return 0;
  return null;
}

// v11 (P2, "dependencias con impacto"): BFS sobre dependientesDirectosPorId_
// (quién depende directamente de cada actividad_id, precomputado UNA vez en
// listarTareas) para responder "si esta tarea se atrasa, ¿a cuántas otras
// afecta, directa o transitivamente?". Protegido contra ciclos (aunque hoy
// nada los crea -- depende_de es de solo lectura para el usuario) con un set
// de visitados; sin eso, un ciclo dejaría este BFS dando vueltas para
// siempre en vez de simplemente fallar la validación en otro lado.
function calcularImpactoDependencia_(actividadId, dependientesDirectosPorId_) {
  var vistos = {};
  var cola = (dependientesDirectosPorId_[actividadId] || []).slice();
  cola.forEach(function (a) { vistos[a.actividad_id] = true; });
  var resultado = [];
  while (cola.length) {
    var actual = cola.shift();
    resultado.push(actual);
    (dependientesDirectosPorId_[actual.actividad_id] || []).forEach(function (siguiente) {
      if (!vistos[siguiente.actividad_id]) { vistos[siguiente.actividad_id] = true; cola.push(siguiente); }
    });
  }
  return resultado;
}

// v13 (Fase 1, "ruta crítica"): responde la pregunta ejecutiva "¿qué cadena
// de tareas puede atrasar el proyecto entero?". Es un CPM clásico (Critical
// Path Method) sobre la MISMA red de dependencias que ya alimenta el impacto
// de retraso -- cero dato nuevo, todo derivado on-read.
//
// Modelo, alineado con la filosofía del módulo (§I "nada mueve fechas solo"):
//  - Duración plan de cada tarea = días entre fecha_creacion y
//    fecha_compromiso (mín. 1). Sin fechas => 1 día (no la excluye, pero pesa
//    lo mínimo).
//  - Pase adelante: inicio-temprano/fin-temprano encadenando por depende_de.
//  - Pase atrás: inicio-tardío/fin-tardío desde el fin del proyecto.
//  - Holgura = inicio_tardío − inicio_temprano. Crítica = holgura ≈ 0.
//
// DECISIÓN deliberada: la ruta crítica es la cadena de DEPENDENCIAS más larga.
// Una tarea SIN dependencias (ni predecesora ni dependientes) nunca se marca
// crítica -- atrasarla no arrastra a ninguna otra, así que no forma "ruta".
// Si el proyecto no tiene NINGUNA dependencia definida, `disponible:false` y
// el frontend invita a definirlas en vez de resaltar la tarea más larga
// (que sería un dato engañoso). Guarda de ciclos igual que el impacto.
function calcularRutaCritica_(tareas) {
  function dur(t) {
    if (!t || !t.fecha_creacion || !t.fecha_compromiso) return 1;
    var d = (new Date(t.fecha_compromiso) - new Date(t.fecha_creacion)) / 86400000;
    return d > 1 ? d : 1;
  }
  var porId = {};
  tareas.forEach(function (t) { porId[t.actividad_id] = t; });
  var sucesores = {}, tienePred = {}, hayDependencias = false;
  tareas.forEach(function (t) {
    if (t.depende_de && porId[t.depende_de]) {
      (sucesores[t.depende_de] = sucesores[t.depende_de] || []).push(t.actividad_id);
      tienePred[t.actividad_id] = true;
      hayDependencias = true;
    }
  });
  if (!hayDependencias) return { disponible: false, porTarea: {} };

  // Pase adelante: fin-temprano (EF) e inicio-temprano (ES), memoizado.
  var EF = {}, ES = {};
  function calcEF(id, pila) {
    if (EF[id] !== undefined) return EF[id];
    pila = pila || {};
    if (pila[id]) return (EF[id] = dur(porId[id])); // ciclo: corta seguro
    pila[id] = true;
    var t = porId[id];
    var es = (t.depende_de && porId[t.depende_de]) ? calcEF(t.depende_de, pila) : 0;
    ES[id] = es; EF[id] = es + dur(t);
    delete pila[id];
    return EF[id];
  }
  tareas.forEach(function (t) { calcEF(t.actividad_id); });

  // Fin del proyecto = mayor fin-temprano ENTRE las tareas de la red.
  var finProyecto = 0;
  tareas.forEach(function (t) {
    if ((tienePred[t.actividad_id] || sucesores[t.actividad_id]) && EF[t.actividad_id] > finProyecto) {
      finProyecto = EF[t.actividad_id];
    }
  });

  // Pase atrás: fin-tardío (LF) e inicio-tardío (LS), memoizado.
  var LF = {}, LS = {};
  function calcLF(id, pila) {
    if (LF[id] !== undefined) return LF[id];
    pila = pila || {};
    if (pila[id]) return (LF[id] = finProyecto);
    pila[id] = true;
    var succ = sucesores[id] || [];
    var lf = finProyecto;
    if (succ.length) {
      lf = Infinity;
      succ.forEach(function (sid) {
        var ls = calcLF(sid, pila) - dur(porId[sid]);
        if (ls < lf) lf = ls;
      });
    }
    LF[id] = lf; LS[id] = lf - dur(porId[id]);
    delete pila[id];
    return LF[id];
  }
  tareas.forEach(function (t) { calcLF(t.actividad_id); });

  var porTarea = {};
  tareas.forEach(function (t) {
    var id = t.actividad_id;
    if (!(tienePred[id] || sucesores[id])) { porTarea[id] = { en_red: false, es_critica: false, holgura_dias: null }; return; }
    var holgura = Math.round((LS[id] - ES[id]) * 10) / 10;
    porTarea[id] = { en_red: true, es_critica: holgura <= 0.5, holgura_dias: holgura };
  });
  return { disponible: true, porTarea: porTarea };
}

function redond1Analitica_(n) { return Math.round(n * 10) / 10; }

// v11 (P3, "lead time"): desde que la tarea se CREÓ hasta que se TERMINÓ --
// el tiempo total que estuvo en el sistema, incluyendo cualquier espera
// antes de que alguien la empezara a trabajar de verdad. Sin fecha_terminada
// (no ha cerrado) no hay lead time que medir todavía -- null, no un número
// a medio camino.
function calcularLeadTimeDias_(a) {
  if (!a.fecha_creacion || !a.fecha_terminada) return null;
  return redond1Analitica_((new Date(a.fecha_terminada) - new Date(a.fecha_creacion)) / 86400000);
}

// v11 (P3, "cycle time"): desde la PRIMERA señal de trabajo real (un
// check-in que avanza algo, no solo la asignación) hasta que se terminó --
// a diferencia del lead time, no cuenta el tiempo en cola antes de
// arrancar. "Trabajo real" = CHECKIN_AVANCE/CHECKIN_SIN_CAMBIO/DESBLOQUEO,
// o un REGISTRO_DIA (P0) cuyo estado_dia no sea "asignado"/"planificado"
// (esos dos son intención, no trabajo hecho). Sin una señal así, o sin
// fecha_terminada, no hay cycle time medible -- null.
var CYCLE_TIME_TIPOS_TRABAJO_ = ['CHECKIN_AVANCE', 'CHECKIN_SIN_CAMBIO', 'DESBLOQUEO'];
var CYCLE_TIME_ESTADOS_DIA_INTENCION_ = ['asignado', 'planificado'];
function calcularCycleTimeDias_(a, eventos) {
  if (!a.fecha_terminada) return null;
  var primeraSenal = null;
  eventos.forEach(function (b) {
    var esTrabajo = CYCLE_TIME_TIPOS_TRABAJO_.indexOf(b.tipo) !== -1;
    if (!esTrabajo && b.tipo === 'REGISTRO_DIA') {
      var d = datosDeBitacora_(b);
      esTrabajo = CYCLE_TIME_ESTADOS_DIA_INTENCION_.indexOf(d.estado_dia) === -1;
    }
    if (!esTrabajo) return;
    var t = new Date(b.timestamp);
    if (isNaN(t.getTime())) return;
    if (primeraSenal === null || t < primeraSenal) primeraSenal = t;
  });
  if (primeraSenal === null) return null;
  return redond1Analitica_((new Date(a.fecha_terminada) - primeraSenal) / 86400000);
}

// v11 (P3, "tiempo en bloqueo/revisión"): suma la duración de cada intervalo
// [apertura, cierre] emparejando CRONOLÓGICAMENTE -- el primer evento de
// cierre que aparece DESPUÉS de una apertura la resuelve (si una tarea se
// bloquea/desbloquea varias veces, cada ciclo cuenta aparte). Si el último
// intervalo quedó abierto (sigue bloqueada/en revisión ahora mismo), cuenta
// hasta AHORA -- "cuánto lleva así" es más útil que "no medible todavía".
function sumarIntervalosBitacora_(eventos, tiposApertura, tiposCierre, ahora) {
  var ordenados = eventos.slice().sort(function (a, b) { return new Date(a.timestamp) - new Date(b.timestamp); });
  var totalMs = 0, abiertoDesde = null;
  ordenados.forEach(function (ev) {
    if (tiposApertura.indexOf(ev.tipo) !== -1 && abiertoDesde === null) {
      abiertoDesde = new Date(ev.timestamp);
    } else if (tiposCierre.indexOf(ev.tipo) !== -1 && abiertoDesde !== null) {
      totalMs += new Date(ev.timestamp).getTime() - abiertoDesde.getTime();
      abiertoDesde = null;
    }
  });
  if (abiertoDesde !== null) totalMs += ahora.getTime() - abiertoDesde.getTime();
  return totalMs / 86400000;
}

// v11 (P1, "congelar línea base"): la baseline VIGENTE es el evento BASELINE
// más reciente de PROYECTO_EVENTOS -- ver Proyectos.congelarBaseline. Sin
// hoja ni columna nueva (mismo patrón que REGISTRO_DIA en P0, aplicado a
// eventos en vez de bitácora).
function obtenerUltimaBaseline_(proyectoId) {
  // .reverse() antes del sort: dos congelamientos seguidos en la misma
  // ejecucion pueden empatar al milisegundo (new Date() sucesivos); un sort
  // ESTABLE conserva el orden de empate tal cual llega, así que se arranca
  // en orden "mas nuevo insertado primero" para que un empate lo resuelva a
  // favor del ultimo congelado, no del primero.
  var eventos = leerFilasSeguro_(SHEETS.PROYECTO_EVENTOS).filter(function (e) {
    return e.proyecto_id === proyectoId && e.tipo === 'BASELINE';
  }).reverse().sort(function (a, b) { return new Date(b.timestamp) - new Date(a.timestamp); });
  if (!eventos.length) return null;
  var evento = eventos[0];
  var datos;
  try { datos = JSON.parse(evento.cuerpo); } catch (e) { datos = null; }
  if (!datos || !Array.isArray(datos.tareas)) return null;
  var porTarea = {};
  datos.tareas.forEach(function (t) {
    porTarea[t.actividad_id] = { fecha_inicio: t.fecha_inicio || '', fecha_fin: t.fecha_fin || '' };
  });
  return { timestamp: evento.timestamp, autor_nombre: evento.autor_nombre || evento.autor_email, por_tarea: porTarea };
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
// v11 (P1, "score de salud explicable y ponderado"): pesos DOCUMENTADOS (no
// una IA, no una caja negra) que restan de 100 -- uno por cada señal objetiva
// que ya alimentaba el semáforo codigo/etiqueta/motivos de siempre. El número
// es un RESUMEN adicional, nunca reemplaza los motivos en texto plano: ambos
// se calculan de la MISMA pasada, así que siempre son consistentes entre sí.
var SALUD_PESOS_ = {
  hito_vencido: 15, tarea_critica_atrasada: 12, tarea_atrasada: 5,
  bloqueo_estancado: 15, tarea_bloqueada: 6, sin_actualizar: 4,
  entregable_vencido: 8, entregable_observado: 5
};

function calcularSaludProyecto_(proyecto, tareas, hitos, entregables) {
  if (proyecto.salud_override) {
    var etiquetas = { critico: 'Crítico', riesgo: 'En riesgo', normal: 'Normal' };
    return {
      codigo: proyecto.salud_override,
      etiqueta: etiquetas[proyecto.salud_override] || proyecto.salud_override,
      motivos: [proyecto.salud_override_motivo || 'Fijado manualmente.'],
      // Sin score: es una corrección MANUAL, no vale la pena fingir una
      // precisión numérica que nadie calculó.
      score: null, penalizacion: null, desglose: []
    };
  }
  if (proyecto.estado === PROYECTOS_ESTADOS.CERRADO || proyecto.estado === PROYECTOS_ESTADOS.CANCELADO) {
    return { codigo: 'normal', etiqueta: 'Normal', motivos: [], score: 100, penalizacion: 0, desglose: [] };
  }

  var activas = tareas.filter(function (a) { return a.activa === true || a.activa === 'TRUE' || a.activa === 1; });
  var motivosCriticos = [], motivosRiesgo = [], desglose = [];
  var ahora = new Date();

  function anota(bucket, factor, cantidad, texto) {
    var puntos = cantidad * SALUD_PESOS_[factor];
    bucket.push(cantidad + texto);
    desglose.push({ factor: factor, cantidad: cantidad, puntos: puntos });
  }

  var hitosVencidos = (hitos || []).filter(function (h) {
    return h.estado !== 'COMPLETADO' && h.estado !== 'CANCELADO' && h.fecha_objetivo && new Date(h.fecha_objetivo) < ahora;
  });
  if (hitosVencidos.length > 0) anota(motivosCriticos, 'hito_vencido', hitosVencidos.length, ' hito(s) vencido(s)');

  var tareasAtrasadas = activas.filter(function (a) { return semaforoActividad_(a).codigo === 'atrasada'; });
  var criticasAtrasadas = tareasAtrasadas.filter(function (a) { return ['P1', 'P2'].indexOf(a.prioridad) !== -1; });
  if (criticasAtrasadas.length > 0) anota(motivosCriticos, 'tarea_critica_atrasada', criticasAtrasadas.length, ' tarea(s) crítica(s) atrasada(s)');
  else if (tareasAtrasadas.length > 0) anota(motivosRiesgo, 'tarea_atrasada', tareasAtrasadas.length, ' tarea(s) atrasada(s)');

  var bloqueadas = activas.filter(function (a) { return a.estado === 'BLOQUEADA'; });
  var feriados = obtenerFeriados_();
  var bloqueoEstancado = bloqueadas.filter(function (a) {
    return a.bloqueo_desde && Utils.horasHabilesEntre(a.bloqueo_desde, ahora, { feriados: feriados }) / 9 >= 2;
  });
  if (bloqueoEstancado.length > 0) anota(motivosCriticos, 'bloqueo_estancado', bloqueoEstancado.length, ' bloqueo(s) estancado(s) (2+ días hábiles)');
  else if (bloqueadas.length > 0) anota(motivosRiesgo, 'tarea_bloqueada', bloqueadas.length, ' tarea(s) bloqueada(s)');

  var sinActualizar = activas.filter(function (a) {
    if (!a.ultima_actualizacion) return false;
    return Utils.horasHabilesEntre(a.ultima_actualizacion, ahora, { feriados: feriados }) / 9 >= 5;
  });
  if (sinActualizar.length > 0) anota(motivosRiesgo, 'sin_actualizar', sinActualizar.length, ' tarea(s) sin actualizar hace 5+ días hábiles');

  // v9.4 (Fase 2, §J de la propuesta): "entregable observado/vencido" como
  // señal de riesgo. APROBADO/CANCELADO son estados que ya no aportan
  // riesgo; el resto (PENDIENTE/ENTREGADO/OBSERVADO) sigue vigente.
  var entregablesVigentes = (entregables || []).filter(function (e) { return e.estado !== 'APROBADO' && e.estado !== 'CANCELADO'; });
  var entregablesVencidos = entregablesVigentes.filter(function (e) {
    return e.fecha_comprometida && new Date(e.fecha_comprometida) < ahora;
  });
  if (entregablesVencidos.length > 0) anota(motivosRiesgo, 'entregable_vencido', entregablesVencidos.length, ' entregable(s) vencido(s)');
  var entregablesObservados = entregablesVigentes.filter(function (e) { return e.estado === 'OBSERVADO'; });
  if (entregablesObservados.length > 0) anota(motivosRiesgo, 'entregable_observado', entregablesObservados.length, ' entregable(s) observado(s)');

  // La penalizacion acumulada es LA cifra que se muestra: apunta en la
  // misma direccion que la etiqueta (mas puntos, peor). El score sobre 100
  // se mantiene en el payload porque el PDF y el desglose lo venian usando,
  // pero ya no es lo que se enseña junto al pill.
  var penalizacion = Math.min(100, desglose.reduce(function (s, d) { return s + d.puntos; }, 0));
  var score = Math.max(0, 100 - penalizacion);

  if (motivosCriticos.length > 0) {
    return { codigo: 'critico', etiqueta: 'Crítico', motivos: motivosCriticos.concat(motivosRiesgo), score: score, penalizacion: penalizacion, desglose: desglose };
  }
  if (motivosRiesgo.length > 0) {
    return { codigo: 'riesgo', etiqueta: 'En riesgo', motivos: motivosRiesgo, score: score, penalizacion: penalizacion, desglose: desglose };
  }
  return { codigo: 'normal', etiqueta: 'Normal', motivos: [], score: 100, desglose: [] };
}

// "Requiere tu atencion" (§12 de la propuesta): lo que un lider necesita ver
// sin tener que ir a buscarlo.
// v13 (Fase 2, "dashboard ejecutivo"): además de los CONTADORES de siempre
// (que el PDF ya consume -- se mantienen intactos, byte a byte), ahora
// también arma `items`: una lista ACCIONABLE (título + a qué pestaña
// navegar) para que el Resumen deje de ser un número mudo y pase a señalar
// el origen de cada alerta. Tope de 8 -- "atención requerida" que no cabe en
// una pantalla deja de comunicar, ver criterio ya usado en impacto_titulos
// (P2, tope 3) y las bandas de KPI (§8: "evitar indicadores vanidosos").
function calcularRequiereAtencion_(tareas, hitos, integrantes, riesgos) {
  var ahora = new Date();
  var activas = tareas.filter(function (a) { return a.activa === true || a.activa === 'TRUE' || a.activa === 1; });
  var vencidas = activas.filter(function (a) { return semaforoActividad_(a).codigo === 'atrasada'; });
  var bloqueadas = activas.filter(function (a) { return a.estado === 'BLOQUEADA'; });
  var hitosAtrasados = (hitos || []).filter(function (h) {
    return h.estado !== 'COMPLETADO' && h.estado !== 'CANCELADO' && h.fecha_objetivo && new Date(h.fecha_objetivo) < ahora;
  });
  // Mismo criterio de "crítica" que ya usa la salud ponderada (SALUD_PESOS_,
  // tarea_critica_atrasada): prioridad P1/P2 Y atrasada. Es un criterio
  // distinto y más simple que la ruta crítica (CPM, Fase 1) -- aquí interesa
  // "urgente por prioridad declarada", no "en la cadena que fija la fecha".
  var criticasAtrasadas = vencidas.filter(function (a) { return ['P1', 'P2'].indexOf(a.prioridad) !== -1; });
  var riesgosAltos = (riesgos || []).filter(function (r) { return r.nivel === 'ALTA' && r.estado === 'ABIERTO'; });

  var items = [];
  criticasAtrasadas.forEach(function (a) {
    items.push({ tipo: 'tarea_critica_atrasada', tab: 'tareas', titulo: a.titulo, meta: 'Prioridad ' + a.prioridad + ' · vencida' });
  });
  bloqueadas.forEach(function (a) {
    items.push({ tipo: 'tarea_bloqueada', tab: 'tareas', titulo: a.titulo, meta: a.bloqueo_motivo || 'Bloqueada' });
  });
  vencidas.forEach(function (a) {
    if (['P1', 'P2'].indexOf(a.prioridad) !== -1) return; // ya listada arriba como crítica
    items.push({ tipo: 'tarea_vencida', tab: 'tareas', titulo: a.titulo, meta: 'Venció ' + fechaCortaPdfProyecto_(a.fecha_compromiso) });
  });
  hitosAtrasados.forEach(function (h) {
    items.push({ tipo: 'hito_atrasado', tab: 'hitos', titulo: h.nombre, meta: 'Vencía ' + fechaCortaPdfProyecto_(h.fecha_objetivo) });
  });
  riesgosAltos.forEach(function (r) {
    items.push({ tipo: 'riesgo_alto', tab: 'riesgos', titulo: r.descripcion, meta: 'Riesgo alto · abierto' });
  });

  return {
    tareas_vencidas: vencidas.length,
    tareas_bloqueadas: bloqueadas.length,
    hitos_atrasados: hitosAtrasados.length,
    total_integrantes: (integrantes || []).length,
    tareas_criticas_atrasadas: criticasAtrasadas.length,
    riesgos_altos: riesgosAltos.length,
    items: items.slice(0, 8),
    items_total: items.length
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
