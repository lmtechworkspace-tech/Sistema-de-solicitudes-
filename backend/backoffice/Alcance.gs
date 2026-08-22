/**
 * Alcance.gs — v11.0 Fase 1: alcance del SGC y exclusiones (§4.3).
 *
 * §4.3 pide tres cosas concretas, y hasta ahora ninguna vivia en el sistema:
 * que el alcance este disponible como informacion documentada, que diga a que
 * productos y servicios aplica, y que **toda clausula que no se aplique quede
 * declarada con su justificacion**.
 *
 * El DOC-01 de la empresa ya las cumple en Word. El problema es que la matriz
 * de cobertura no podia verlas: preguntaba "¿hay evidencia de 4.3?" mirando
 * documentos etiquetados a mano, y no tenia forma de saber que la organizacion
 * excluyo 7.1.5.2 y 8.5.1 f). Para el auditor eso son dos preguntas sin
 * respuesta en pantalla.
 *
 * Cuatro decisiones:
 *
 * 1. NADA se siembra solo. El modulo trae la declaracion del DOC-01 como
 *    PROPUESTA (`ALCANCE_PROPUESTO_DOC01`), la muestra prellenada y no la
 *    guarda hasta que una persona la revisa y confirma. Sembrar el alcance
 *    automaticamente seria poner en boca de la organizacion algo que nadie
 *    aprobo dentro del sistema.
 *
 * 2. La exclusion se guarda con la granularidad del manual, incluida la
 *    SUB-clausula ('7.1.5.2'). El catalogo de la matriz trabaja a nivel de
 *    clausula (7.1), asi que se deriva `clausula_padre` al guardar y es por
 *    ahi que la matriz la encuentra. Ese era exactamente el vacio.
 *
 * 3. Excluir una SUB-clausula NO cambia el estado de la clausula padre. 7.1
 *    sigue aplicando entera menos ese pedazo; degradarla a "no aplica" seria
 *    peor que no tener la funcion. Solo una exclusion de la clausula COMPLETA
 *    ('8.3', tal cual figura en el catalogo) la marca NO_APLICA.
 *
 * 4. La justificacion es obligatoria. Una exclusion sin justificacion no es
 *    una exclusion valida para §4.3 -- es una clausula incumplida con otro
 *    nombre. El sistema no deja guardarla.
 */

// Edicion de la norma con la que trabaja el sistema hoy. Vive aca y no
// desperdigada porque el alcance es quien DECLARA contra que edicion rige: el
// dia que exista una edicion nueva, se agrega su catalogo de clausulas y un
// alcance que la declare, sin reescribir el modulo.
var NORMA_SGC_POR_DEFECTO = { codigo: 'ISO 9001', version: '2015' };

// Versiones de norma que el sistema sabe evaluar. Mientras solo haya una, la
// lista existe igual: es el punto donde se engancha una edicion futura, y
// evita que el codigo asuma "2015" en veinte lugares distintos.
var VERSIONES_NORMA_SOPORTADAS = ['2015'];

// La declaracion tal como esta en el DOC-01 "Manual de calidad". Se ofrece
// PRELLENADA y no se guarda sola (decision 1 de la cabecera). El texto se
// transcribe del documento, no se redacta aca.
var ALCANCE_PROPUESTO_DOC01 = {
  razon_social: 'Asesorías Integrales AyS SpA',
  nombre_fantasia: 'HomePymes SpA',
  rut: '78.194.394-0',
  declaracion: 'Prestación de servicios de asesoría integral en gestión administrativa ' +
    'y recursos humanos, contabilidad, prevención de riesgos y marketing corporativo, ' +
    'orientados a empresas contratistas, pymes y subcontratistas del sector construcción ' +
    'y otros rubros.',
  areas: ['Recursos Humanos', 'Contabilidad', 'Prevención de Riesgos', 'Marketing Corporativo'],
  ubicaciones: ['Av. Grecia 1938, Ñuñoa'],
  norma_codigo: NORMA_SGC_POR_DEFECTO.codigo,
  norma_version: NORMA_SGC_POR_DEFECTO.version,
  exclusiones: [
    {
      clausula: '7.1.5.2',
      titulo: 'Trazabilidad de las mediciones',
      justificacion: 'La organización no realiza mediciones que requieran equipos de ' +
        'seguimiento y medición trazables a patrones nacionales o internacionales: los ' +
        'servicios prestados son de asesoría documental y administrativa.'
    },
    {
      clausula: '8.5.1 f',
      titulo: 'Validación y revalidación periódica de procesos cuyas salidas no pueden verificarse',
      justificacion: 'Las salidas de los servicios prestados son verificables mediante ' +
        'actividades de seguimiento y medición posteriores (revisión y liberación por la ' +
        'jefatura de cada área), por lo que no aplica la validación de procesos especiales.'
    }
  ],
  // Lo que el analisis de Fase 0 dejo abierto y NO se resuelve por cuenta del
  // sistema. Se muestra junto al formulario para que quien confirme el
  // alcance lo decida a la vista.
  advertencias: [
    'El DOC-01 declara cuatro áreas. El DOC-03 (mapa de procesos) además lista ' +
      'Administración y Facturación y Cobranzas como procesos de apoyo. Confirma si ' +
      'forman parte del alcance declarado o son soporte interno.'
  ]
};

var ESTADOS_ALCANCE = { VIGENTE: 'VIGENTE', REEMPLAZADO: 'REEMPLAZADO' };

var Alcance = {

  /**
   * El alcance vigente con sus exclusiones. Lectura abierta a cualquiera que
   * entre a Calidad: §4.3 pide que el alcance este DISPONIBLE, y es lo mas
   * publico que tiene un SGC. Editarlo sigue siendo del Encargado.
   */
  obtener: function (data, contexto) {
    var rol = rolSgc_(contexto);
    var gobierna = gobiernaSgc_(contexto, rol);

    var vigente = alcanceVigente_();
    var exclusiones = vigente ? exclusionesDe_(vigente.alcance_id) : [];

    return {
      puede_gestionar: gobierna,
      norma_por_defecto: NORMA_SGC_POR_DEFECTO,
      versiones_norma: VERSIONES_NORMA_SOPORTADAS,
      clausulas_catalogo: CLAUSULAS_ISO9001,
      alcance: vigente ? formatearAlcance_(vigente) : null,
      exclusiones: exclusiones.map(formatearExclusion_),
      historial: historialAlcance_(),
      // Sin alcance declarado se devuelve la propuesta del DOC-01 para que el
      // formulario venga lleno. Es una SUGERENCIA: no esta en la planilla.
      propuesta: vigente ? null : ALCANCE_PROPUESTO_DOC01
    };
  },

  /**
   * Crea el alcance si no existe, o corrige el vigente. Corregir en el mismo
   * registro es lo correcto para un error de tipeo; cuando el alcance cambia
   * de verdad se usa `nuevaVersion`, que conserva el anterior.
   */
  guardar: function (data, contexto) {
    var rol = rolSgc_(contexto);
    if (!gobiernaSgc_(contexto, rol)) {
      return { _forbidden: true, message: 'Solo el Encargado del SGC puede declarar el alcance.' };
    }

    var val = validarAlcance_(data);
    if (val.error) return { ok: false, message: val.error };

    var vigente = alcanceVigente_();
    var ahora = new Date().toISOString();

    if (!vigente) {
      var alcanceId = Utilities.getUuid();
      agregarFila_(SHEETS.SGC_ALCANCE, {
        alcance_id: alcanceId,
        version: '01',
        estado: ESTADOS_ALCANCE.VIGENTE,
        razon_social: val.datos.razon_social,
        nombre_fantasia: val.datos.nombre_fantasia,
        rut: val.datos.rut,
        declaracion: val.datos.declaracion,
        areas: JSON.stringify(val.datos.areas),
        ubicaciones: JSON.stringify(val.datos.ubicaciones),
        norma_codigo: val.datos.norma_codigo,
        norma_version: val.datos.norma_version,
        documento_id: val.datos.documento_id,
        observaciones: val.datos.observaciones,
        vigente_desde: val.datos.vigente_desde || ahora.slice(0, 10),
        reemplazado_por: '',
        creado_por: (contexto && contexto.email) || '',
        fecha_creacion: ahora,
        activa: true
      });
      registrarLogSgc_('SGC_ALCANCE_DECLARADO', 'Alcance del SGC declarado (v01)', contexto);
      return { ok: true, alcance_id: alcanceId, message: 'Alcance declarado.' };
    }

    actualizarFilaPorId_(SHEETS.SGC_ALCANCE, 'alcance_id', vigente.alcance_id, {
      razon_social: val.datos.razon_social,
      nombre_fantasia: val.datos.nombre_fantasia,
      rut: val.datos.rut,
      declaracion: val.datos.declaracion,
      areas: JSON.stringify(val.datos.areas),
      ubicaciones: JSON.stringify(val.datos.ubicaciones),
      norma_codigo: val.datos.norma_codigo,
      norma_version: val.datos.norma_version,
      documento_id: val.datos.documento_id,
      observaciones: val.datos.observaciones,
      vigente_desde: val.datos.vigente_desde || vigente.vigente_desde
    });
    registrarLogSgc_('SGC_ALCANCE_EDITADO', 'Alcance del SGC corregido (v' + vigente.version + ')', contexto);
    return { ok: true, alcance_id: vigente.alcance_id, message: 'Alcance actualizado.' };
  },

  /**
   * Publica una version nueva: la anterior pasa a REEMPLAZADO y se conserva.
   * Las exclusiones se copian a la version nueva -- si no se copiaran, publicar
   * una version dejaria a la organizacion sin exclusiones declaradas de un dia
   * para otro, que es justo el estado que §4.3 no admite.
   */
  nuevaVersion: function (data, contexto) {
    var rol = rolSgc_(contexto);
    if (!gobiernaSgc_(contexto, rol)) {
      return { _forbidden: true, message: 'Solo el Encargado del SGC puede publicar una versión del alcance.' };
    }

    var vigente = alcanceVigente_();
    if (!vigente) return { ok: false, message: 'Todavía no hay un alcance declarado que reemplazar.' };

    var val = validarAlcance_(data);
    if (val.error) return { ok: false, message: val.error };
    if (!String(data.justificacion_cambio || '').trim()) {
      return { ok: false, message: 'Indica por qué cambia el alcance: queda como trazabilidad de la versión anterior.' };
    }

    var ahora = new Date().toISOString();
    var nuevoId = Utilities.getUuid();
    var versionNueva = siguienteVersionAlcance_(vigente.version);

    agregarFila_(SHEETS.SGC_ALCANCE, {
      alcance_id: nuevoId,
      version: versionNueva,
      estado: ESTADOS_ALCANCE.VIGENTE,
      razon_social: val.datos.razon_social,
      nombre_fantasia: val.datos.nombre_fantasia,
      rut: val.datos.rut,
      declaracion: val.datos.declaracion,
      areas: JSON.stringify(val.datos.areas),
      ubicaciones: JSON.stringify(val.datos.ubicaciones),
      norma_codigo: val.datos.norma_codigo,
      norma_version: val.datos.norma_version,
      documento_id: val.datos.documento_id,
      observaciones: val.datos.observaciones,
      vigente_desde: val.datos.vigente_desde || ahora.slice(0, 10),
      reemplazado_por: '',
      creado_por: (contexto && contexto.email) || '',
      fecha_creacion: ahora,
      activa: true
    });

    // El motivo se guarda en la version que SE REEMPLAZA, no en la nueva:
    // es la respuesta a "por que dejo de regir esta", que es lo que se
    // pregunta al recorrer el historial.
    actualizarFilaPorId_(SHEETS.SGC_ALCANCE, 'alcance_id', vigente.alcance_id, {
      estado: ESTADOS_ALCANCE.REEMPLAZADO,
      reemplazado_por: nuevoId,
      observaciones: String(data.justificacion_cambio).trim()
    });

    // Las exclusiones viajan con la version nueva.
    exclusionesDe_(vigente.alcance_id).forEach(function (ex) {
      agregarFila_(SHEETS.SGC_EXCLUSIONES, {
        exclusion_id: Utilities.getUuid(),
        alcance_id: nuevoId,
        clausula: ex.clausula,
        clausula_padre: ex.clausula_padre,
        titulo: ex.titulo,
        justificacion: ex.justificacion,
        creado_por: (contexto && contexto.email) || '',
        fecha_creacion: ahora,
        activa: true
      });
    });

    registrarLogSgc_('SGC_ALCANCE_NUEVA_VERSION',
      'Alcance v' + vigente.version + ' → v' + versionNueva, contexto);
    return { ok: true, alcance_id: nuevoId, version: versionNueva, message: 'Alcance v' + versionNueva + ' publicado.' };
  },

  /**
   * Declara o corrige una exclusion. La justificacion es obligatoria: sin
   * ella no es una exclusion valida para §4.3.
   */
  guardarExclusion: function (data, contexto) {
    var rol = rolSgc_(contexto);
    if (!gobiernaSgc_(contexto, rol)) {
      return { _forbidden: true, message: 'Solo el Encargado del SGC puede declarar exclusiones.' };
    }

    var vigente = alcanceVigente_();
    if (!vigente) return { ok: false, message: 'Declara primero el alcance: una exclusión es parte de él.' };

    var clausula = String(data.clausula || '').trim();
    var justificacion = String(data.justificacion || '').trim();
    if (!clausula) return { ok: false, message: 'Indica qué cláusula se excluye.' };
    if (!justificacion) {
      return { ok: false, message: 'La justificación es obligatoria: §4.3 exige explicar por qué la cláusula no aplica.' };
    }

    var padre = clausulaPadreIso_(clausula);
    if (!padre) {
      return { ok: false, message: 'La cláusula "' + clausula + '" no tiene el formato esperado (por ejemplo 7.1.5.2 u 8.3).' };
    }
    if (!existeClausulaIso_(padre)) {
      return { ok: false, message: 'La cláusula "' + clausula + '" no corresponde a ningún capítulo auditable de la norma.' };
    }

    var ahora = new Date().toISOString();
    var existentes = exclusionesDe_(vigente.alcance_id);

    if (data.exclusion_id) {
      var actual = existentes.filter(function (e) { return e.exclusion_id === data.exclusion_id; })[0];
      if (!actual) return { ok: false, message: 'No se encontró la exclusión que quieres corregir.' };
      actualizarFilaPorId_(SHEETS.SGC_EXCLUSIONES, 'exclusion_id', actual.exclusion_id, {
        clausula: clausula,
        clausula_padre: padre,
        titulo: String(data.titulo || '').trim(),
        justificacion: justificacion
      });
      registrarLogSgc_('SGC_EXCLUSION_EDITADA', 'Exclusión ' + clausula + ' corregida', contexto);
      return { ok: true, exclusion_id: actual.exclusion_id, message: 'Exclusión actualizada.' };
    }

    var repetida = existentes.filter(function (e) { return e.clausula === clausula; })[0];
    if (repetida) return { ok: false, message: 'La cláusula ' + clausula + ' ya está declarada como exclusión.' };

    var id = Utilities.getUuid();
    agregarFila_(SHEETS.SGC_EXCLUSIONES, {
      exclusion_id: id,
      alcance_id: vigente.alcance_id,
      clausula: clausula,
      clausula_padre: padre,
      titulo: String(data.titulo || '').trim(),
      justificacion: justificacion,
      creado_por: (contexto && contexto.email) || '',
      fecha_creacion: ahora,
      activa: true
    });
    registrarLogSgc_('SGC_EXCLUSION_DECLARADA', 'Exclusión ' + clausula + ' declarada', contexto);
    return { ok: true, exclusion_id: id, message: 'Exclusión declarada.' };
  },

  anularExclusion: function (data, contexto) {
    var rol = rolSgc_(contexto);
    if (!gobiernaSgc_(contexto, rol)) {
      return { _forbidden: true, message: 'Solo el Encargado del SGC puede retirar una exclusión.' };
    }
    var vigente = alcanceVigente_();
    if (!vigente) return { ok: false, message: 'No hay alcance declarado.' };

    var ex = exclusionesDe_(vigente.alcance_id).filter(function (e) {
      return e.exclusion_id === data.exclusion_id;
    })[0];
    if (!ex) return { ok: false, message: 'No se encontró la exclusión.' };

    actualizarFilaPorId_(SHEETS.SGC_EXCLUSIONES, 'exclusion_id', ex.exclusion_id, { activa: false });
    registrarLogSgc_('SGC_EXCLUSION_RETIRADA',
      'Exclusión ' + ex.clausula + ' retirada: la cláusula vuelve a aplicar', contexto);
    return { ok: true, message: 'Exclusión retirada. La cláusula vuelve a considerarse aplicable.' };
  }
};

// --- helpers ----------------------------------------------------------------

function alcanceVigente_() {
  var filas = leerFilasSeguro_(SHEETS.SGC_ALCANCE).filter(function (a) {
    return esVerdaderoSgc_(a.activa) && a.estado === ESTADOS_ALCANCE.VIGENTE;
  });
  // Si por cualquier razon hubiera mas de uno vigente, gana el ultimo creado:
  // es el que la organizacion declaro mas recientemente.
  filas.sort(function (a, b) {
    return String(a.fecha_creacion || '').localeCompare(String(b.fecha_creacion || ''));
  });
  return filas.length ? filas[filas.length - 1] : null;
}

function exclusionesDe_(alcanceId) {
  if (!alcanceId) return [];
  return leerFilasSeguro_(SHEETS.SGC_EXCLUSIONES).filter(function (e) {
    return esVerdaderoSgc_(e.activa) && e.alcance_id === alcanceId;
  });
}

/**
 * Las exclusiones vigentes agrupadas por clausula PADRE, que es como las
 * consulta la matriz de cobertura. Se expone aparte para que la matriz no
 * tenga que saber como estan guardadas.
 */
function exclusionesVigentesPorClausula_() {
  var vigente = alcanceVigente_();
  var mapa = {};
  if (!vigente) return mapa;
  exclusionesDe_(vigente.alcance_id).forEach(function (e) {
    var padre = e.clausula_padre || clausulaPadreIso_(e.clausula);
    if (!padre) return;
    if (!mapa[padre]) mapa[padre] = [];
    mapa[padre].push({
      clausula: e.clausula,
      titulo: e.titulo || '',
      justificacion: e.justificacion || '',
      // Una exclusion de la clausula COMPLETA es la unica que puede marcarla
      // NO_APLICA. Excluir 7.1.5.2 no saca del alcance a 7.1 entera.
      total: String(e.clausula).trim() === padre
    });
  });
  return mapa;
}

/**
 * '7.1.5.2' → '7.1' · '8.5.1 f' → '8.5' · '8.3' → '8.3'
 * Los dos primeros segmentos numericos, que es la granularidad del catalogo.
 */
function clausulaPadreIso_(clausula) {
  var limpio = String(clausula || '').trim();
  var m = limpio.match(/^(\d+)\.(\d+)/);
  if (!m) return '';
  return m[1] + '.' + m[2];
}

function existeClausulaIso_(codigo) {
  for (var i = 0; i < CLAUSULAS_ISO9001.length; i++) {
    if (CLAUSULAS_ISO9001[i].codigo === codigo) return true;
  }
  return false;
}

function siguienteVersionAlcance_(actual) {
  var n = parseInt(String(actual || '0').replace(/\D/g, ''), 10);
  if (!isFinite(n) || n < 1) n = 1;
  var sig = String(n + 1);
  return sig.length < 2 ? '0' + sig : sig;
}

function listaDesdeJson_(valor) {
  if (Array.isArray(valor)) return valor;
  var texto = String(valor == null ? '' : valor).trim();
  if (!texto) return [];
  try {
    var parsed = JSON.parse(texto);
    return Array.isArray(parsed) ? parsed : [];
  } catch (err) {
    // Tolerancia deliberada: si alguien edito la celda a mano en la planilla
    // y escribio "RRHH, Contabilidad", se lee igual en vez de perder el dato.
    return texto.split(',').map(function (s) { return s.trim(); }).filter(Boolean);
  }
}

function formatearAlcance_(fila) {
  return {
    alcance_id: fila.alcance_id,
    version: fila.version,
    estado: fila.estado,
    razon_social: fila.razon_social,
    nombre_fantasia: fila.nombre_fantasia,
    rut: fila.rut,
    declaracion: fila.declaracion,
    areas: listaDesdeJson_(fila.areas),
    ubicaciones: listaDesdeJson_(fila.ubicaciones),
    norma_codigo: fila.norma_codigo,
    norma_version: fila.norma_version,
    documento_id: fila.documento_id || '',
    observaciones: fila.observaciones || '',
    vigente_desde: fila.vigente_desde || '',
    creado_por: fila.creado_por || '',
    fecha_creacion: fila.fecha_creacion || ''
  };
}

function formatearExclusion_(fila) {
  return {
    exclusion_id: fila.exclusion_id,
    clausula: fila.clausula,
    clausula_padre: fila.clausula_padre || clausulaPadreIso_(fila.clausula),
    titulo: fila.titulo || '',
    justificacion: fila.justificacion || '',
    total: String(fila.clausula).trim() === (fila.clausula_padre || clausulaPadreIso_(fila.clausula)),
    creado_por: fila.creado_por || '',
    fecha_creacion: fila.fecha_creacion || ''
  };
}

function historialAlcance_() {
  return leerFilasSeguro_(SHEETS.SGC_ALCANCE)
    .filter(function (a) { return esVerdaderoSgc_(a.activa) && a.estado === ESTADOS_ALCANCE.REEMPLAZADO; })
    .map(function (a) {
      return {
        alcance_id: a.alcance_id,
        version: a.version,
        declaracion: a.declaracion,
        vigente_desde: a.vigente_desde || '',
        observaciones: a.observaciones || '',
        fecha_creacion: a.fecha_creacion || ''
      };
    })
    .sort(function (x, y) { return String(y.fecha_creacion).localeCompare(String(x.fecha_creacion)); });
}

function validarAlcance_(data) {
  var d = data || {};
  var declaracion = String(d.declaracion || '').trim();
  if (!declaracion) {
    return { error: 'La declaración de alcance es obligatoria: es lo que §4.3 pide mantener documentado.' };
  }
  var razon = String(d.razon_social || '').trim();
  if (!razon) {
    return { error: 'Indica la razón social: es el nombre con el que se emite el certificado.' };
  }

  var areas = Array.isArray(d.areas)
    ? d.areas.map(function (s) { return String(s).trim(); }).filter(Boolean)
    : listaDesdeJson_(d.areas);
  if (!areas.length) {
    return { error: 'Indica al menos un área dentro del alcance.' };
  }

  var version = String(d.norma_version || NORMA_SGC_POR_DEFECTO.version).trim();
  if (VERSIONES_NORMA_SOPORTADAS.indexOf(version) === -1) {
    return { error: 'El sistema todavía no evalúa la edición ' + version + ' de la norma.' };
  }

  return {
    datos: {
      razon_social: razon,
      nombre_fantasia: String(d.nombre_fantasia || '').trim(),
      rut: String(d.rut || '').trim(),
      declaracion: declaracion,
      areas: areas,
      ubicaciones: Array.isArray(d.ubicaciones)
        ? d.ubicaciones.map(function (s) { return String(s).trim(); }).filter(Boolean)
        : listaDesdeJson_(d.ubicaciones),
      norma_codigo: String(d.norma_codigo || NORMA_SGC_POR_DEFECTO.codigo).trim(),
      norma_version: version,
      documento_id: String(d.documento_id || '').trim(),
      observaciones: String(d.observaciones || '').trim(),
      vigente_desde: String(d.vigente_desde || '').trim()
    }
  };
}
