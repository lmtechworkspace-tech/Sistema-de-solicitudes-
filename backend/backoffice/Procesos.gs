/**
 * Procesos.gs — v11.0 Fase 4: procesos del SGC (§4.4, y base de §8.1, §8.5 y
 * §8.6).
 *
 * §4.4 pide determinar los procesos necesarios para el SGC, su secuencia e
 * interaccion, sus entradas y salidas, y quien es responsable de cada uno.
 * El DOC-03 "Mapa de procesos v02" ya lo tiene resuelto: 14 procesos en tres
 * categorias. Esto lo estructura, no lo reescribe.
 *
 * Dos niveles, una sola hoja:
 *
 *   MAPA      los 14 del DOC-03. Chicos, estables, y cierran §4.4 por si
 *             solos. Van sembrados desde el codigo.
 *   SERVICIO  los 40 de los DOC-10 a DOC-13, colgando del proceso del mapa
 *             al que pertenecen. Son 143 pasos y ~135 KB de texto: se cargan
 *             por planilla, no desde el codigo. Meter eso en un archivo que
 *             se pega a mano en Apps Script seria pagar ese peso en cada
 *             despliegue, y no aporta nada a cambio.
 *
 * Lo que esta fase NO hace, a proposito: no registra la EJECUCION de un
 * proceso para un cliente y un periodo. Eso es la Fase 8 y es lo unico con
 * riesgo de escala (≈7.200 registros al año con 50 clientes). Definir el
 * proceso y registrar cada vez que se ejecuta son cosas distintas, y
 * mezclarlas fue lo que hizo parecer imposible esta parte durante meses.
 */

var TIPOS_PROCESO = ['ESTRATEGICO', 'OPERATIVO', 'APOYO'];
var NIVELES_PROCESO = ['MAPA', 'SERVICIO'];

var ETIQUETA_TIPO_PROCESO = {
  ESTRATEGICO: 'Estratégico',
  OPERATIVO: 'Operativo',
  APOYO: 'Apoyo'
};

// Misma frecuencia anual que el contexto y los riesgos: el DOC-03 se revisa
// en el ciclo del SGC, no en uno propio.
var MESES_REVISION_PROCESOS = 12;

// Los 14 procesos del DOC-03 v02, transcritos con los contenidos que la caja
// de cada uno declara en el mapa. El `codigo` lo asigna el sistema (el mapa
// no numera los procesos) siguiendo el tipo, para poder citarlos.
var PROCESOS_PROPUESTOS_DOC03 = [
  {
    codigo: 'PE-01', tipo: 'ESTRATEGICO', nombre: 'Dirección y Planificación Estratégica',
    actividades: 'Contexto organizacional FODA (DOC-02)\nPartes interesadas y alcance SGC (DOC-04)\nPolítica de Calidad (DOC-06)\nObjetivos de Calidad (DOC-07)\nAsignación de recursos y roles\nPlanificación de cambios'
  },
  {
    codigo: 'PE-02', tipo: 'ESTRATEGICO', nombre: 'Gestión del Sistema de Calidad (SGC)',
    actividades: 'Implementación y mantención ISO 9001:2015\nControl de documentos y registros\nMatriz de riesgos y oportunidades (DOC-08)\nMapa de procesos (DOC-03)\nCoordinación con consultora PRT'
  },
  {
    codigo: 'PE-03', tipo: 'ESTRATEGICO', nombre: 'Revisión por la Dirección',
    actividades: 'Revisión de indicadores y objetivos\nAnálisis de satisfacción del cliente\nResultados de auditorías internas\nEstado de acciones correctivas\nDesempeño de proveedores externos\nOportunidades de mejora continua'
  },

  {
    codigo: 'PO-01', tipo: 'OPERATIVO', nombre: 'Gestión Comercial y Ventas',
    area: 'Comercial',
    actividades: 'Prospección y captación de clientes\nPropuestas de servicio y cotización\nFormalización de contratos/acuerdos',
    observaciones: 'El DOC-03 lo marca "(EXT)". Confirmar si sigue siendo externo: el análisis de agosto registró que Comercial y Marketing pasaron a ser internos.'
  },
  {
    codigo: 'PO-02', tipo: 'OPERATIVO', nombre: 'Administración',
    area: 'Administración',
    actividades: 'Coordinación integral de servicios\nAsignación de requerimientos a áreas\nCentralización de KPIs por área\nSeguimiento de cumplimiento de plazos'
  },
  {
    codigo: 'PO-03', tipo: 'OPERATIVO', nombre: 'Gestión de RRHH',
    area: 'Recursos Humanos',
    actividades: 'Remuneraciones manual y digital\nAdministración de plataformas externas\nPlataformas: FacilRemu, Previred, DT',
    documentos: 'DOC-11 Documentos servicios a clientes RRHH'
  },
  {
    codigo: 'PO-04', tipo: 'OPERATIVO', nombre: 'Gestión de Contabilidad',
    area: 'Contabilidad',
    actividades: 'Contabilidad Renta Tributaria\nContabilidad Mensual (F29)\nCreación de empresas\nPlataformas: SII, TGR',
    documentos: 'DOC-10 Documentos servicios a clientes Contabilidad'
  },
  {
    codigo: 'PO-05', tipo: 'OPERATIVO', nombre: 'Gestión de Prevención de Riesgos',
    area: 'Prevención de Riesgos',
    actividades: 'Gestión documental de prevención\nGestión organizacional administrativa\nAsesoría en terreno',
    documentos: 'DOC-12 Documentos servicios a clientes Prevención de Riesgos'
  },
  {
    codigo: 'PO-06', tipo: 'OPERATIVO', nombre: 'Marketing Corporativo',
    area: 'Marketing Corporativo',
    actividades: 'Branding corporativo para clientes',
    documentos: 'DOC-13 Documentos servicios a clientes Marketing Corporativo'
  },

  {
    codigo: 'PA-01', tipo: 'APOYO', nombre: 'Gestión de RR.HH. (Interno)',
    actividades: 'Descriptores de cargo (FO-PRO-02-01)\nPrograma de capacitación\nObjetivo: ≥5 hrs formación/colaborador/año'
  },
  {
    codigo: 'PA-02', tipo: 'APOYO', nombre: 'Control de Documentos y Registros',
    actividades: 'Codificación: DOC / PRO / FO / INS\nCiclo: elaboración → revisión → aprobación\nRevisión periódica cada 12 meses\nListado maestro de documentos'
  },
  {
    codigo: 'PA-03', tipo: 'APOYO', nombre: 'Facturación y Cobranzas',
    actividades: 'Emisión de facturas\nGestión de cobranza\nControl de liquidez\nSeguimiento de pagos pendientes'
  },
  {
    codigo: 'PA-04', tipo: 'APOYO', nombre: 'Gestión de Proveedores y Plataformas',
    actividades: 'Evaluación y monitoreo de proveedores\nGDE - HomePymes Digital\nFacilRemu / FacilCont\nRLD - Intranet'
  },
  {
    codigo: 'PA-05', tipo: 'APOYO', nombre: 'Medición, Análisis y Mejora',
    actividades: 'Encuestas de satisfacción (≥90% nota ≥8)\nGestión de reclamos (<2% sobre total de servicios)\nAuditoría interna del SGC\nNo conformidades y acciones correctivas\nRetención de clientes (objetivo ≥70% al año)'
  }
];

// Entradas y salidas globales del mapa: el DOC-03 las pone a los costados
// ("Necesidades del cliente" -> procesos -> "Satisfacción del cliente"), no
// por proceso. Se muestran como cabecera del mapa y no se inventan por
// proceso una por una.
var FLUJO_MAPA_DOC03 = {
  entrada: {
    titulo: 'Necesidades del cliente',
    items: [
      'Cobertura de áreas sin recursos propios',
      'Asesoría integral en un solo proveedor',
      'Atención personalizada y seguimiento continuo',
      'Cumplimiento de plazos',
      'Información fidedigna',
      'Acceso a plataforma digital'
    ],
    partes: 'Clientes · Alta Dirección · Colaboradores · Proveedores'
  },
  salida: {
    titulo: 'Satisfacción del cliente',
    items: [
      'Encuesta de satisfacción ≥90% nota ≥8',
      'Reclamos <2% del total de servicios',
      'Cumplimiento de plazos ≥90%',
      'Retención ≥70% clientes/año',
      'Crecimiento ≥15% nuevos servicios/año'
    ],
    retroalimentacion: 'Reclamos · Felicitaciones · Sugerencias · Encuestas'
  },
  ciclo: 'PHVA aplicado a todos los procesos: Planificar (contexto, riesgos, objetivos, recursos) · ' +
    'Hacer (operación, servicios, controles) · Verificar (seguimiento, medición, auditoría) · ' +
    'Actuar (mejora continua, acciones correctivas)'
};

var Procesos = {

  listar: function (data, contexto) {
    var rol = rolSgc_(contexto);
    var gobierna = gobiernaSgc_(contexto, rol);

    var filas = procesosActivos_();
    var pasos = pasosActivos_();
    var porProceso = {};
    pasos.forEach(function (p) {
      if (!porProceso[p.proceso_id]) porProceso[p.proceso_id] = 0;
      porProceso[p.proceso_id]++;
    });

    var riesgos = leerFilasSeguro_(SHEETS.SGC_RIESGOS).filter(function (r) {
      return esVerdaderoSgc_(r.activa) && r.proceso_id;
    });
    var riesgosPorProceso = {};
    riesgos.forEach(function (r) {
      if (!riesgosPorProceso[r.proceso_id]) riesgosPorProceso[r.proceso_id] = 0;
      riesgosPorProceso[r.proceso_id]++;
    });

    var lista = filas.map(function (p) {
      return formatearProceso_(p, porProceso[p.proceso_id] || 0, riesgosPorProceso[p.proceso_id] || 0);
    });

    return {
      puede_gestionar: gobierna,
      tipos: TIPOS_PROCESO,
      meses_revision: MESES_REVISION_PROCESOS,
      flujo: FLUJO_MAPA_DOC03,
      mapa: lista.filter(function (p) { return p.nivel === 'MAPA'; }),
      servicios: lista.filter(function (p) { return p.nivel === 'SERVICIO'; }),
      resumen: resumenProcesos_(lista, pasos),
      propuesta: filas.length ? null : { mapa: PROCESOS_PROPUESTOS_DOC03.length }
    };
  },

  getDetalle: function (data, contexto) {
    var rol = rolSgc_(contexto);
    var gobierna = gobiernaSgc_(contexto, rol);

    var p = procesosActivos_().filter(function (x) { return x.proceso_id === data.proceso_id; })[0];
    if (!p) return errorValidacion_('proceso_id', 'Proceso no encontrado.');

    var pasos = pasosActivos_()
      .filter(function (x) { return x.proceso_id === p.proceso_id; })
      .sort(function (a, b) { return (Number(a.numero) || 0) - (Number(b.numero) || 0); });

    var hijos = procesosActivos_().filter(function (x) { return x.proceso_padre_id === p.proceso_id; });

    var riesgos = leerFilasSeguro_(SHEETS.SGC_RIESGOS).filter(function (r) {
      return esVerdaderoSgc_(r.activa) && r.proceso_id === p.proceso_id;
    }).map(function (r) {
      var v = valorarRiesgo_(r.probabilidad, r.impacto);
      return {
        riesgo_id: r.riesgo_id, codigo: r.codigo, clase: r.clase, factor: r.factor,
        banda: v ? v.banda : '', magnitud: v ? v.magnitud : null
      };
    });

    return {
      puede_gestionar: gobierna,
      proceso: formatearProceso_(p, pasos.length, riesgos.length),
      pasos: pasos.map(formatearPaso_),
      subprocesos: hijos.map(function (h) {
        return { proceso_id: h.proceso_id, codigo: h.codigo, nombre: h.nombre, area: h.area || '' };
      }),
      riesgos: riesgos
    };
  },

  sembrarMapa: function (data, contexto) {
    var rol = rolSgc_(contexto);
    if (!gobiernaSgc_(contexto, rol)) {
      return { _forbidden: true, message: 'Solo el Encargado del SGC puede cargar el mapa de procesos.' };
    }
    if (procesosActivos_().filter(function (p) { return p.nivel === 'MAPA'; }).length) {
      return { ok: false, message: 'El mapa ya está cargado. Agrega o edita los procesos uno a uno.' };
    }

    var ahora = new Date().toISOString();
    var hoy = ahora.slice(0, 10);
    var email = (contexto && contexto.email) || '';

    PROCESOS_PROPUESTOS_DOC03.forEach(function (p) {
      agregarFila_(SHEETS.SGC_PROCESOS, {
        // El id ES el codigo. Los procesos de servicio se cargan por
        // planilla y enlazan con proceso_padre_id = 'PO-04': nadie va a
        // tipear un UUID a mano en una celda.
        proceso_id: p.codigo,
        codigo: p.codigo,
        nombre: p.nombre,
        tipo: p.tipo,
        nivel: 'MAPA',
        proceso_padre_id: '',
        area: p.area || '',
        objetivo: '',
        alcance: '',
        responsable_email: '',
        entradas: '',
        actividades: p.actividades || '',
        salidas: '',
        clientes: '',
        proveedores: '',
        recursos: '',
        documentos: p.documentos || '',
        clausulas_iso: '',
        estado: 'VIGENTE',
        observaciones: p.observaciones || '',
        fecha_ultima_revision: hoy,
        revisado_por: email,
        creado_por: email,
        fecha_creacion: ahora,
        activa: true
      });
    });

    registrarLogSgc_('SGC_PROCESOS_SEMBRADOS',
      PROCESOS_PROPUESTOS_DOC03.length + ' procesos del DOC-03 v02 cargados', contexto);
    return {
      ok: true, total: PROCESOS_PROPUESTOS_DOC03.length,
      message: 'Mapa de procesos cargado: ' + PROCESOS_PROPUESTOS_DOC03.length + ' procesos.'
    };
  },

  guardar: function (data, contexto) {
    var rol = rolSgc_(contexto);
    if (!gobiernaSgc_(contexto, rol)) {
      return { _forbidden: true, message: 'Solo el Encargado del SGC puede editar los procesos.' };
    }

    var val = validarProceso_(data);
    if (val.error) return { ok: false, message: val.error };

    var ahora = new Date().toISOString();
    var campos = val.datos;
    campos.fecha_ultima_revision = ahora.slice(0, 10);
    campos.revisado_por = (contexto && contexto.email) || '';

    if (data.proceso_id) {
      var actual = procesosActivos_().filter(function (p) { return p.proceso_id === data.proceso_id; })[0];
      if (!actual) return { ok: false, message: 'No se encontró el proceso.' };
      actualizarFilaPorId_(SHEETS.SGC_PROCESOS, 'proceso_id', actual.proceso_id, campos);
      registrarLogSgc_('SGC_PROCESO_EDITADO', actual.codigo + ' actualizado', contexto);
      return { ok: true, proceso_id: actual.proceso_id, message: 'Proceso actualizado.' };
    }

    campos.proceso_id = Utilities.getUuid();
    if (!campos.codigo) campos.codigo = siguienteCodigoProceso_(campos.tipo, campos.nivel);
    campos.estado = 'VIGENTE';
    campos.creado_por = (contexto && contexto.email) || '';
    campos.fecha_creacion = ahora;
    campos.activa = true;
    agregarFila_(SHEETS.SGC_PROCESOS, campos);
    registrarLogSgc_('SGC_PROCESO_AGREGADO', campos.codigo + ' agregado', contexto);
    return { ok: true, proceso_id: campos.proceso_id, message: 'Proceso agregado.' };
  },

  anular: function (data, contexto) {
    var rol = rolSgc_(contexto);
    if (!gobiernaSgc_(contexto, rol)) {
      return { _forbidden: true, message: 'Solo el Encargado del SGC puede quitar procesos.' };
    }
    var p = procesosActivos_().filter(function (x) { return x.proceso_id === data.proceso_id; })[0];
    if (!p) return { ok: false, message: 'No se encontró el proceso.' };

    var hijos = procesosActivos_().filter(function (x) { return x.proceso_padre_id === p.proceso_id; });
    if (hijos.length) {
      return {
        ok: false,
        message: 'Este proceso tiene ' + hijos.length + ' proceso(s) de servicio colgando. ' +
          'Reasígnalos o quítalos primero: dejarlos huérfanos los sacaría del mapa sin avisar.'
      };
    }

    actualizarFilaPorId_(SHEETS.SGC_PROCESOS, 'proceso_id', p.proceso_id, { activa: false });
    registrarLogSgc_('SGC_PROCESO_QUITADO', p.codigo + ' quitado', contexto);
    return { ok: true, message: 'Proceso quitado.' };
  },

  registrarRevision: function (data, contexto) {
    var rol = rolSgc_(contexto);
    if (!gobiernaSgc_(contexto, rol)) {
      return { _forbidden: true, message: 'Solo el Encargado del SGC puede registrar la revisión.' };
    }
    var filas = procesosActivos_();
    if (!filas.length) return { ok: false, message: 'No hay procesos que revisar todavía.' };

    var hoy = new Date().toISOString().slice(0, 10);
    var email = (contexto && contexto.email) || '';
    filas.forEach(function (p) {
      actualizarFilaPorId_(SHEETS.SGC_PROCESOS, 'proceso_id', p.proceso_id,
        { fecha_ultima_revision: hoy, revisado_por: email });
    });
    registrarLogSgc_('SGC_PROCESOS_REVISADOS', 'Mapa de procesos revisado al ' + hoy, contexto);
    return { ok: true, message: 'Revisión registrada al ' + hoy + '.' };
  }
};

// --- helpers ----------------------------------------------------------------

function procesosActivos_() {
  return leerFilasSeguro_(SHEETS.SGC_PROCESOS).filter(function (p) {
    return esVerdaderoSgc_(p.activa);
  });
}

function pasosActivos_() {
  return leerFilasSeguro_(SHEETS.SGC_PROCESO_PASOS).filter(function (p) {
    return esVerdaderoSgc_(p.activa);
  });
}

function siguienteCodigoProceso_(tipo, nivel) {
  var prefijo = nivel === 'SERVICIO' ? 'SRV'
    : (tipo === 'ESTRATEGICO' ? 'PE' : (tipo === 'APOYO' ? 'PA' : 'PO'));
  var max = 0;
  procesosActivos_().forEach(function (p) {
    var m = String(p.codigo || '').match(new RegExp('^' + prefijo + '-(\\d+)$'));
    if (!m) return;
    var n = parseInt(m[1], 10);
    if (isFinite(n) && n > max) max = n;
  });
  var sig = String(max + 1);
  return prefijo + '-' + (sig.length < 2 ? '0' + sig : sig);
}

function formatearProceso_(p, totalPasos, totalRiesgos) {
  return {
    proceso_id: p.proceso_id,
    codigo: p.codigo || '',
    nombre: p.nombre || '',
    tipo: p.tipo || '',
    tipo_etiqueta: ETIQUETA_TIPO_PROCESO[p.tipo] || p.tipo || '',
    nivel: p.nivel || 'MAPA',
    proceso_padre_id: p.proceso_padre_id || '',
    area: p.area || '',
    objetivo: p.objetivo || '',
    alcance: p.alcance || '',
    responsable_email: p.responsable_email || '',
    entradas: p.entradas || '',
    actividades: p.actividades || '',
    salidas: p.salidas || '',
    clientes: p.clientes || '',
    proveedores: p.proveedores || '',
    recursos: p.recursos || '',
    documentos: p.documentos || '',
    clausulas_iso: parsearClausulasIsoSgc_(p.clausulas_iso),
    estado: p.estado || 'VIGENTE',
    observaciones: p.observaciones || '',
    total_pasos: totalPasos || 0,
    total_riesgos: totalRiesgos || 0,
    fecha_ultima_revision: p.fecha_ultima_revision || '',
    revisado_por: p.revisado_por || ''
  };
}

function formatearPaso_(p) {
  return {
    paso_id: p.paso_id,
    numero: Number(p.numero) || 0,
    nombre: p.nombre || '',
    responsable: p.responsable || '',
    input: p.input || '',
    actividades: p.actividades || '',
    evidencias: p.evidencias || '',
    output: p.output || '',
    observaciones: p.observaciones || ''
  };
}

function resumenProcesos_(lista, pasos) {
  var mapa = lista.filter(function (p) { return p.nivel === 'MAPA'; });
  var porTipo = { ESTRATEGICO: 0, OPERATIVO: 0, APOYO: 0 };
  mapa.forEach(function (p) {
    if (porTipo[p.tipo] === undefined) porTipo[p.tipo] = 0;
    porTipo[p.tipo]++;
  });

  var fechas = lista
    .map(function (p) { return String(p.fecha_ultima_revision || '').slice(0, 10); })
    .filter(Boolean).sort();
  var ultima = fechas.length ? fechas[0] : '';
  var meses = (typeof mesesDesde_ === 'function') ? mesesDesde_(ultima) : null;

  return {
    total_mapa: mapa.length,
    total_servicios: lista.length - mapa.length,
    total_pasos: pasos.length,
    por_tipo: porTipo,
    // "Sin responsable" mira solo el mapa: son los procesos que §4.4 pide
    // asignar. Un proceso de servicio hereda el responsable del suyo.
    sin_responsable: mapa.filter(function (p) { return !String(p.responsable_email || '').trim(); }).length,
    sin_objetivo: mapa.filter(function (p) { return !String(p.objetivo || '').trim(); }).length,
    servicios_sin_pasos: lista.filter(function (p) {
      return p.nivel === 'SERVICIO' && !p.total_pasos;
    }).length,
    ultima_revision: ultima,
    meses_desde_revision: meses,
    revision_vencida: meses !== null && meses >= MESES_REVISION_PROCESOS
  };
}

function validarProceso_(data) {
  var d = data || {};
  var nombre = String(d.nombre || '').trim();
  if (!nombre) return { error: 'Indica el nombre del proceso.' };

  var tipo = String(d.tipo || '').trim().toUpperCase();
  if (TIPOS_PROCESO.indexOf(tipo) === -1) {
    return { error: 'El tipo tiene que ser estratégico, operativo o de apoyo.' };
  }
  var nivel = String(d.nivel || 'MAPA').trim().toUpperCase();
  if (NIVELES_PROCESO.indexOf(nivel) === -1) nivel = 'MAPA';

  var padre = String(d.proceso_padre_id || '').trim();
  if (nivel === 'SERVICIO' && !padre) {
    return { error: 'Un proceso de servicio tiene que colgar de un proceso del mapa.' };
  }
  if (nivel === 'MAPA' && padre) {
    return { error: 'Un proceso del mapa no cuelga de otro: es el nivel más alto.' };
  }
  if (padre && d.proceso_id && padre === d.proceso_id) {
    return { error: 'Un proceso no puede colgar de sí mismo.' };
  }

  return {
    datos: {
      codigo: String(d.codigo || '').trim(),
      nombre: nombre,
      tipo: tipo,
      nivel: nivel,
      proceso_padre_id: padre,
      area: String(d.area || '').trim(),
      objetivo: String(d.objetivo || '').trim(),
      alcance: String(d.alcance || '').trim(),
      responsable_email: String(d.responsable_email || '').trim(),
      entradas: String(d.entradas || '').trim(),
      actividades: String(d.actividades || '').trim(),
      salidas: String(d.salidas || '').trim(),
      clientes: String(d.clientes || '').trim(),
      proveedores: String(d.proveedores || '').trim(),
      recursos: String(d.recursos || '').trim(),
      documentos: String(d.documentos || '').trim(),
      clausulas_iso: Array.isArray(d.clausulas_iso) ? JSON.stringify(d.clausulas_iso) : String(d.clausulas_iso || ''),
      observaciones: String(d.observaciones || '').trim()
    }
  };
}
