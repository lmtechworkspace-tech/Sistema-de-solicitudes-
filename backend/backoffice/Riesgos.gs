/**
 * Riesgos.gs — v11.0 Fase 3: riesgos y oportunidades (§6.1).
 *
 * El DOC-08 es el documento del material que mas gana al digitalizarse,
 * porque no es una lista: es un modelo de valoracion numerico completo.
 * Probabilidad x impacto = magnitud, con bandas definidas, y una SEGUNDA
 * pasada de revaloracion despues de aplicar los controles.
 *
 * Cuatro decisiones:
 *
 * 1. La magnitud y su banda NO se guardan: se CALCULAN. En el documento
 *    original 7 de las 32 valoraciones no coinciden con su propia tabla de
 *    criterios (la mas clara: probabilidad 0,1 x impacto 10 = 1, que es
 *    "Bajo", rotulado "Moderado"). Calculandolas deja de ser posible que
 *    discrepen, y esa es la mitad del valor de esta fase.
 *
 * 2. En una OPORTUNIDAD, una magnitud alta es BUENA y la revaloracion
 *    deberia SUBIR, no bajar. Un motor que pinte de rojo lo alto y de verde
 *    lo bajo mostraria al reves la mitad de la matriz. Por eso `favorable`
 *    viaja en cada respuesta y el tono del semaforo se invierte.
 *
 * 3. La accion de tratamiento es una ACTIVIDAD del motor v7.0, igual que las
 *    correcciones de una NC y los acuerdos de la revision por la direccion.
 *    Crear un tercer sistema de tareas seria el peor error de esta etapa: el
 *    responsable ya tiene un solo lugar donde ve lo que le toca.
 *
 * 4. Un riesgo se enlaza al FACTOR DEL FODA que lo origina. Siete de los
 *    once riesgos del DOC-08 son literalmente debilidades y amenazas del
 *    DOC-02; sin ese enlace, la cadena factor -> riesgo -> accion se pierde
 *    y hay que reconstruirla de memoria en cada auditoria.
 */

// Escalas del DOC-08, hoja "Valoración". Son de la empresa, no propuestas
// por el sistema: se transcriben con su etiqueta y su valor.
var PROBABILIDAD_RIESGO = [
  { valor: 0.1, etiqueta: 'Baja', detalle: 'Frecuencia del evento como máximo 1 vez al año' },
  { valor: 0.5, etiqueta: 'Media', detalle: 'Frecuencia del evento como máximo 2 a 3 veces al año (meses no seguidos)' },
  { valor: 1.0, etiqueta: 'Alta', detalle: 'Frecuencia del evento a lo menos 3 a 5 veces y 2 meses seguidos' }
];

var IMPACTO_RIESGO = [
  { valor: 1, etiqueta: 'Insignificante' },
  { valor: 5, etiqueta: 'Bajo' },
  { valor: 10, etiqueta: 'Moderado' },
  { valor: 25, etiqueta: 'Alto' },
  { valor: 50, etiqueta: 'Crítico' }
];

// Bandas de magnitud, con el limite INFERIOR inclusivo. Asi esta escrito en
// la tabla de criterios del DOC-08 ("Alto: 10 ≤ X > 25", "Crítico: 25 ≤ X ≥
// 50"): el <= va del lado bajo. Varias filas del documento no siguen su
// propia tabla en los bordes (2,5 y 25); manda la tabla, no las filas.
var BANDAS_MAGNITUD = [
  { hasta: 0.5, etiqueta: 'Insignificante', tono: 'neutro' },
  { hasta: 2.5, etiqueta: 'Bajo', tono: 'ok' },
  { hasta: 10, etiqueta: 'Moderado', tono: 'info' },
  { hasta: 25, etiqueta: 'Alto', tono: 'alerta' },
  { hasta: Infinity, etiqueta: 'Crítico', tono: 'critico' }
];

// El DOC-08 declara "Fecha: Agosto 2026 / Fecha próxima revisión: Junio
// 2027" en riesgos y "Junio 2026 / Junio 2027" en oportunidades. La
// frecuencia que ambas fechas describen es anual; se usa la misma que el
// contexto para que el ciclo del SGC sea uno solo.
var MESES_REVISION_RIESGOS = 12;

// Los 11 riesgos del DOC-08, transcritos. `factor_foda` es el codigo del
// factor del DOC-02 que origina el riesgo: siete de los once salen
// literalmente de una debilidad o una amenaza del FODA, y al sembrar se
// enlazan solos si el contexto ya esta cargado.
//
// NO se transcribe la magnitud ni la banda: se calculan. Siete de las 32
// valoraciones del documento no coinciden con su propia tabla de criterios.
var RIESGOS_PROPUESTOS_DOC08 = [
  {
    clase: 'RIESGO', codigo: 'R1', factor_foda: 'D1',
    relacion_actividad: 'Gestión de Procesos',
    factor: 'Ausencia de indicadores de gestión (KPIs)',
    descripcion: 'No se han establecido, definido e implementado indicadores de gestión (KPI) en todas las áreas',
    analisis_causa: 'Falta de estandarización en la medición de la gestión por área; no existen tableros de control formalizados',
    procedencia: 'Factores internos: Falta de indicadores de gestión formalizados',
    origen: 'INTERNO', probabilidad: 0.5, impacto: 10,
    accion: 'Definir e implementar KPIs por área alineados a los objetivos de calidad del SGC',
    fecha_implementacion: 'Agosto 2026',
    medidas_control: 'Tableros de control por área, revisión mensual de indicadores, integración con objetivos DOC-07',
    probabilidad_residual: 0.1, impacto_residual: 10
  },
  {
    clase: 'RIESGO', codigo: 'R2', factor_foda: 'D2',
    relacion_actividad: 'Gestión de RRHH',
    factor: 'Ausencia de evaluaciones de desempeño',
    descripcion: 'No se han implementado evaluaciones de desempeño en todas las áreas',
    analisis_causa: 'Falta de instrumentos formales de evaluación del personal; no existe periodicidad definida',
    procedencia: 'Factores internos: Falta de procedimiento de evaluación del personal',
    origen: 'INTERNO', probabilidad: 0.5, impacto: 10,
    accion: 'Implementar formulario de monitoreo de competencias (FO-PRO-02-04) para los 14 trabajadores bajo alcance del SGC',
    fecha_implementacion: 'Agosto 2026',
    medidas_control: 'Evaluación anual por cargo según descriptor (escala 1-4), resultado alimenta programa de capacitación',
    probabilidad_residual: 0.1, impacto_residual: 10
  },
  {
    clase: 'RIESGO', codigo: 'R3', factor_foda: 'D3',
    relacion_actividad: 'Gestión Comercial',
    factor: 'Falta de contratos formales con clientes',
    descripcion: 'Falta de contratos formales con clientes (acuerdos actuales son verbales o por correo)',
    analisis_causa: 'Informalidad en la relación comercial; acuerdos de servicio no documentados contractualmente',
    procedencia: 'Factores internos: Ausencia de formalización contractual',
    origen: 'INTERNO', probabilidad: 1.0, impacto: 25,
    accion: 'Elaborar modelo de contrato estándar de prestación de servicios y formalizar relación con clientes activos',
    fecha_implementacion: 'Septiembre 2026',
    medidas_control: 'Contrato estándar aprobado por gerencia, registro de contratos firmados, seguimiento de vigencia',
    probabilidad_residual: 0.5, impacto_residual: 10
  },
  {
    clase: 'RIESGO', codigo: 'R4', factor_foda: 'D4',
    relacion_actividad: 'Gestión Comercial',
    factor: 'Ausencia de plan de fidelización',
    descripcion: 'No existe plan de fidelización con los clientes',
    analisis_causa: 'Falta de estrategia de retención; no se monitorea la satisfacción de forma sistemática',
    procedencia: 'Factores internos: Falta de estrategia comercial de retención',
    origen: 'INTERNO', probabilidad: 0.5, impacto: 25,
    accion: 'Diseñar e implementar plan de fidelización alineado al objetivo de calidad de retención (≥70%)',
    fecha_implementacion: 'Septiembre 2026',
    medidas_control: 'Encuesta de satisfacción post-servicio, seguimiento de retención semestral, acciones correctivas ante reclamos',
    probabilidad_residual: 0.1, impacto_residual: 25
  },
  {
    clase: 'RIESGO', codigo: 'R5', factor_foda: 'D5',
    relacion_actividad: 'Gestión Documental',
    factor: 'Documentación dispersa en múltiples canales',
    descripcion: 'Documentación dispersa en múltiples canales (Drive, correo, Intranet), riesgo de extravío',
    analisis_causa: 'Ausencia de repositorio centralizado; múltiples plataformas sin estructura unificada de almacenamiento',
    procedencia: 'Factores internos: Falta de control documental centralizado',
    origen: 'INTERNO', probabilidad: 1.0, impacto: 10,
    accion: 'Implementar procedimiento de control de documentos del SGC con repositorio centralizado en Drive',
    fecha_implementacion: 'Agosto 2026',
    medidas_control: 'Procedimiento de Control de Documentos, codificación DOC/PRO/FO/INS, listado maestro actualizado',
    probabilidad_residual: 0.1, impacto_residual: 10
  },
  {
    clase: 'RIESGO', codigo: 'R6', factor_foda: 'D6',
    relacion_actividad: 'Gestión de Procesos',
    factor: 'Procesos internos sin estandarización completa',
    descripcion: 'Procesos internos que carecen de estandarización completa, afectando la eficiencia',
    analisis_causa: 'Falta de procedimientos documentados e instructivos técnicos en las áreas operativas',
    procedencia: 'Factores internos: Falta de documentación y estandarización de procesos',
    origen: 'INTERNO', probabilidad: 0.5, impacto: 25,
    accion: 'Levantar instructivos técnicos (INS-01, INS-02, etc.) para servicios de RRHH, Contabilidad y Prevención',
    fecha_implementacion: 'Agosto 2026',
    medidas_control: 'Instructivos documentados por área, mapa de procesos (DOC-03), revisión periódica cada 12 meses',
    probabilidad_residual: 0.1, impacto_residual: 25
  },
  {
    clase: 'RIESGO', codigo: 'R7', factor_foda: 'D7',
    relacion_actividad: 'Prevención de Riesgos',
    factor: 'Cobertura geográfica limitada',
    descripcion: 'Cobertura geográfica limitada en Prevención de Riesgos (solo Región Metropolitana)',
    analisis_causa: 'Recursos de prevención concentrados en RM; falta de prevencionistas en otras regiones',
    procedencia: 'Factores internos: Limitación de recursos y cobertura territorial',
    origen: 'INTERNO', probabilidad: 0.5, impacto: 10,
    accion: 'Evaluar alianzas o contratación de prevencionistas en regiones con demanda activa',
    fecha_implementacion: 'Post-certificación',
    medidas_control: 'Monitoreo de demanda por región, evaluación de viabilidad de expansión geográfica',
    probabilidad_residual: 0.5, impacto_residual: 10
  },
  {
    clase: 'RIESGO', codigo: 'R8', factor_foda: 'A1',
    relacion_actividad: 'Entorno Competitivo',
    factor: 'Alta competencia en el sector de asesorías',
    descripcion: 'Alta competencia en el sector de asesorías (empresas nacionales)',
    analisis_causa: 'Mercado de asesorías con múltiples competidores nacionales que ofrecen servicios similares',
    procedencia: 'Factor externo: Competencia del mercado nacional de asesorías',
    origen: 'EXTERNO', probabilidad: 0.5, impacto: 25,
    accion: 'Diferenciación mediante certificación ISO 9001 y servicio integral; posicionamiento de marca HomePymes',
    fecha_implementacion: 'Septiembre 2026',
    medidas_control: 'Certificación ISO 9001, estrategia de marketing corporativo, encuesta de satisfacción al cliente',
    probabilidad_residual: 0.5, impacto_residual: 25
  },
  {
    clase: 'RIESGO', codigo: 'R9', factor_foda: 'A2',
    relacion_actividad: 'Gestión Tecnológica',
    factor: 'Rápida obsolescencia tecnológica',
    descripcion: 'Rápida obsolescencia de tecnologías y necesidad de actualización constante',
    analisis_causa: 'Avances tecnológicos acelerados que pueden dejar las plataformas actuales desactualizadas',
    procedencia: 'Factor externo: Avances tecnológicos rápidos del mercado',
    origen: 'EXTERNO', probabilidad: 0.5, impacto: 10,
    accion: 'Migración a plataforma HomePymes Digital; evaluación periódica de herramientas tecnológicas',
    fecha_implementacion: 'Continuo',
    medidas_control: 'Evaluación anual de plataformas, presupuesto de actualización tecnológica',
    probabilidad_residual: 0.1, impacto_residual: 10
  },
  {
    clase: 'RIESGO', codigo: 'R10', factor_foda: 'A3',
    relacion_actividad: 'Gestión de Infraestructura',
    factor: 'Normativas de ciberseguridad más estrictas',
    descripcion: 'Normativas más estrictas en ciberseguridad que pueden aumentar costos',
    analisis_causa: 'Regulación gubernamental en materia de protección de datos y ciberseguridad más exigente',
    procedencia: 'Factor externo: Regulación gubernamental en ciberseguridad',
    origen: 'EXTERNO', probabilidad: 0.1, impacto: 10,
    accion: 'Monitoreo de cambios regulatorios; asegurar cumplimiento de protección de datos en plataformas',
    fecha_implementacion: 'Continuo',
    medidas_control: 'Revisión periódica de normativa vigente, evaluación de cumplimiento en plataformas (FácilCont, Fácil Remu, HomePymes Digital)',
    probabilidad_residual: 0.1, impacto_residual: 10
  },
  {
    clase: 'RIESGO', codigo: 'R11', factor_foda: 'A4',
    relacion_actividad: 'Gestión Comercial',
    factor: 'Clientes sin compromiso contractual de permanencia',
    descripcion: 'Clientes sin compromiso contractual de permanencia mínima',
    analisis_causa: 'Relaciones comerciales informales que permiten al cliente retirarse sin aviso ni penalidad',
    procedencia: 'Factor externo: Dinámica del mercado sin retención contractual',
    origen: 'EXTERNO', probabilidad: 1.0, impacto: 25,
    accion: 'Formalizar contratos con cláusula de permanencia; implementar plan de fidelización',
    fecha_implementacion: 'Septiembre 2026',
    medidas_control: 'Contratos formales, encuesta de satisfacción, seguimiento retención (objetivo ≥70%)',
    probabilidad_residual: 0.5, impacto_residual: 10
  }
];

// Las 5 oportunidades del DOC-08. La hoja de oportunidades no tiene columna
// de analisis de causa: no se inventa una.
var OPORTUNIDADES_PROPUESTAS_DOC08 = [
  {
    clase: 'OPORTUNIDAD', codigo: 'O1', factor_foda: 'O1',
    relacion_actividad: 'Crecimiento Empresarial',
    factor: 'Aumento de demanda de externalización en pymes',
    descripcion: 'Aumento de la demanda de soluciones integrales por parte de pymes que buscan externalizar servicios administrativos',
    procedencia: 'Externo: Tendencia del mercado pyme hacia la externalización de servicios',
    origen: 'EXTERNO', probabilidad: 1.0, impacto: 25,
    accion: 'Fortalecer oferta integral de servicios y posicionar marca HomePymes en segmento pyme',
    fecha_implementacion: 'Continuo',
    medidas_control: 'Estrategia de marketing, certificación ISO 9001, seguimiento de objetivo de crecimiento (≥15% nuevos servicios)',
    probabilidad_residual: 1.0, impacto_residual: 50
  },
  {
    clase: 'OPORTUNIDAD', codigo: 'O2', factor_foda: 'O2',
    relacion_actividad: 'Crecimiento Empresarial',
    factor: 'Expansión a otros rubros de pymes y contratistas',
    descripcion: 'Expansión a otros rubros de pymes y contratistas (agrícola, naviero, retail, etc.)',
    procedencia: 'Externo: Demanda en nuevos sectores económicos',
    origen: 'EXTERNO', probabilidad: 0.5, impacto: 25,
    accion: 'Evaluar demanda y adaptar servicios para rubros agrícola, naviero y retail',
    fecha_implementacion: 'Post-certificación',
    medidas_control: 'Estudio de mercado por sector, adaptación de servicios, alianzas estratégicas sectoriales',
    probabilidad_residual: 1.0, impacto_residual: 25
  },
  {
    clase: 'OPORTUNIDAD', codigo: 'O3', factor_foda: 'O3',
    relacion_actividad: 'Entorno Sectorial',
    factor: 'Reactivación del sector construcción',
    descripcion: 'Reactivación del sector construcción (mayor demanda potencial)',
    procedencia: 'Externo: Ciclo económico del sector construcción',
    origen: 'EXTERNO', probabilidad: 0.5, impacto: 25,
    accion: 'Intensificar acciones comerciales hacia contratistas y subcontratistas del sector construcción',
    fecha_implementacion: 'Continuo',
    medidas_control: 'Plan de ventas enfocado en construcción, seguimiento de indicadores sectoriales, fidelización de clientes actuales',
    probabilidad_residual: 0.5, impacto_residual: 25
  },
  {
    clase: 'OPORTUNIDAD', codigo: 'O4', factor_foda: 'O4',
    relacion_actividad: 'Gestión Tecnológica',
    factor: 'Transformación digital acelerada',
    descripcion: 'Transformación digital acelerada: empresas necesitan migrar sus servicios a sistemas en línea',
    procedencia: 'Externo: Tendencia de digitalización del mercado',
    origen: 'EXTERNO', probabilidad: 1.0, impacto: 25,
    accion: 'Consolidar migración a plataforma HomePymes Digital y ampliar funcionalidades en línea',
    fecha_implementacion: 'Continuo',
    medidas_control: 'Migración a HomePymes Digital, integración con GDE/Facilita/RLD, capacitación a clientes en uso de plataforma',
    probabilidad_residual: 1.0, impacto_residual: 50
  },
  {
    clase: 'OPORTUNIDAD', codigo: 'O5', factor_foda: 'O5',
    relacion_actividad: 'Crecimiento Empresarial',
    factor: 'Internacionalización post-certificación',
    descripcion: 'Internacionalización post-certificación con casa certificadora reconocida',
    procedencia: 'Externo: Reconocimiento internacional de certificación ISO 9001',
    origen: 'EXTERNO', probabilidad: 0.5, impacto: 50,
    accion: 'Seleccionar casa certificadora con reconocimiento internacional (TUV recomendada) para facilitar expansión',
    fecha_implementacion: 'Post-certificación',
    medidas_control: 'Certificación ISO 9001 con casa internacional, evaluación de mercados potenciales, plan de internacionalización',
    probabilidad_residual: 0.5, impacto_residual: 50
  }
];

var CLASES_RIESGO = ['RIESGO', 'OPORTUNIDAD'];
var ESTADOS_RIESGO = ['ABIERTO', 'TRATADO', 'CERRADO'];

var Riesgos = {

  listar: function (data, contexto) {
    var rol = rolSgc_(contexto);
    var gobierna = gobiernaSgc_(contexto, rol);
    if (!(gobierna || veTodoSgc_(contexto, rol, gobierna))) {
      return { _forbidden: true, message: 'No tienes acceso a la matriz de riesgos.' };
    }

    var filas = riesgosActivos_();
    var factores = (typeof factoresContextoActivos_ === 'function') ? factoresContextoActivos_() : [];
    var porFactor = {};
    factores.forEach(function (f) {
      porFactor[f.factor_id] = String(f.tipo || '').slice(0, 1) + f.numero + ' — ' + f.descripcion;
    });

    var actividades = {};
    filas.forEach(function (r) {
      if (!r.accion_actividad_id) return;
      var a = buscarActividadSgc_(r.accion_actividad_id);
      if (a) actividades[r.riesgo_id] = tareaResumen_(a);
    });

    var lista = filas.map(function (r) {
      return formatearRiesgo_(r, porFactor[r.factor_contexto_id] || '', actividades[r.riesgo_id] || null);
    });

    return {
      puede_gestionar: gobierna,
      escala_probabilidad: PROBABILIDAD_RIESGO,
      escala_impacto: IMPACTO_RIESGO,
      bandas: BANDAS_MAGNITUD.map(function (b) {
        return { hasta: b.hasta === Infinity ? null : b.hasta, etiqueta: b.etiqueta };
      }),
      meses_revision: MESES_REVISION_RIESGOS,
      factores_contexto: factores.map(function (f) {
        return { factor_id: f.factor_id, codigo: String(f.tipo || '').slice(0, 1) + f.numero, descripcion: f.descripcion };
      }),
      riesgos: lista.filter(function (r) { return r.clase === 'RIESGO'; }),
      oportunidades: lista.filter(function (r) { return r.clase === 'OPORTUNIDAD'; }),
      resumen: resumenRiesgos_(lista),
      propuesta: filas.length ? null : {
        riesgos: RIESGOS_PROPUESTOS_DOC08.length,
        oportunidades: OPORTUNIDADES_PROPUESTAS_DOC08.length
      }
    };
  },

  /**
   * Carga la matriz del DOC-08. Se siembran SOLO probabilidad e impacto: las
   * magnitudes y las bandas las calcula el sistema, que es como se corrigen
   * solas las siete valoraciones que en el documento no cuadran.
   */
  sembrarDesdeDoc08: function (data, contexto) {
    var rol = rolSgc_(contexto);
    if (!gobiernaSgc_(contexto, rol)) {
      return { _forbidden: true, message: 'Solo el Encargado del SGC puede cargar la matriz de riesgos.' };
    }
    if (riesgosActivos_().length) {
      return { ok: false, message: 'La matriz ya está cargada. Agrega o edita los registros uno a uno.' };
    }

    var ahora = new Date().toISOString();
    var hoy = ahora.slice(0, 10);
    var email = (contexto && contexto.email) || '';
    // Se intenta enlazar cada riesgo con el factor del FODA del que sale.
    var indiceFactores = indiceFactoresPorCodigo_();
    var total = 0;
    var enlazados = 0;

    [].concat(RIESGOS_PROPUESTOS_DOC08, OPORTUNIDADES_PROPUESTAS_DOC08).forEach(function (r) {
      var factorId = r.factor_foda && indiceFactores[r.factor_foda] ? indiceFactores[r.factor_foda] : '';
      if (factorId) enlazados++;
      agregarFila_(SHEETS.SGC_RIESGOS, {
        riesgo_id: Utilities.getUuid(),
        clase: r.clase,
        codigo: r.codigo,
        relacion_actividad: r.relacion_actividad,
        factor: r.factor,
        descripcion: r.descripcion,
        analisis_causa: r.analisis_causa || '',
        procedencia: r.procedencia,
        origen: r.origen,
        factor_contexto_id: factorId,
        probabilidad: r.probabilidad,
        impacto: r.impacto,
        accion: r.accion,
        fecha_implementacion: r.fecha_implementacion,
        medidas_control: r.medidas_control,
        responsable_email: '',
        accion_actividad_id: '',
        probabilidad_residual: r.probabilidad_residual,
        impacto_residual: r.impacto_residual,
        estado: 'ABIERTO',
        observaciones: '',
        fecha_identificacion: hoy,
        fecha_ultima_revision: hoy,
        revisado_por: email,
        creado_por: email,
        fecha_creacion: ahora,
        activa: true
      });
      total++;
    });

    registrarLogSgc_('SGC_RIESGOS_SEMBRADOS',
      total + ' registros del DOC-08 cargados (' + enlazados + ' enlazados al FODA)', contexto);
    return {
      ok: true, total: total, enlazados: enlazados,
      message: 'Matriz cargada: ' + total + ' registros, ' + enlazados + ' enlazados a un factor del contexto.'
    };
  },

  guardar: function (data, contexto) {
    var rol = rolSgc_(contexto);
    if (!gobiernaSgc_(contexto, rol)) {
      return { _forbidden: true, message: 'Solo el Encargado del SGC puede editar la matriz de riesgos.' };
    }

    var val = validarRiesgo_(data);
    if (val.error) return { ok: false, message: val.error };

    var ahora = new Date().toISOString();
    var campos = val.datos;
    campos.fecha_ultima_revision = ahora.slice(0, 10);
    campos.revisado_por = (contexto && contexto.email) || '';

    if (data.riesgo_id) {
      var actual = riesgosActivos_().filter(function (r) { return r.riesgo_id === data.riesgo_id; })[0];
      if (!actual) return { ok: false, message: 'No se encontró el registro.' };
      actualizarFilaPorId_(SHEETS.SGC_RIESGOS, 'riesgo_id', actual.riesgo_id, campos);
      registrarLogSgc_('SGC_RIESGO_EDITADO', actual.codigo + ' actualizado', contexto);
      return { ok: true, riesgo_id: actual.riesgo_id, message: 'Registro actualizado.' };
    }

    campos.riesgo_id = Utilities.getUuid();
    campos.codigo = siguienteCodigoRiesgo_(campos.clase);
    campos.estado = 'ABIERTO';
    campos.accion_actividad_id = '';
    campos.fecha_identificacion = ahora.slice(0, 10);
    campos.creado_por = (contexto && contexto.email) || '';
    campos.fecha_creacion = ahora;
    campos.activa = true;
    agregarFila_(SHEETS.SGC_RIESGOS, campos);
    registrarLogSgc_('SGC_RIESGO_AGREGADO', campos.codigo + ' agregado', contexto);
    return { ok: true, riesgo_id: campos.riesgo_id, message: 'Registro agregado.' };
  },

  /**
   * Convierte la accion de tratamiento en una ACTIVIDAD asignada. Es el
   * mismo eslabon que usan las NC y los acuerdos de direccion: el
   * responsable la ve en "Mi trabajo" y no hay un flujo nuevo que aprender.
   */
  asignarAccion: function (data, contexto) {
    var rol = rolSgc_(contexto);
    if (!gobiernaSgc_(contexto, rol)) {
      return { _forbidden: true, message: 'Solo el Encargado del SGC puede asignar la acción.' };
    }

    var r = riesgosActivos_().filter(function (x) { return x.riesgo_id === data.riesgo_id; })[0];
    if (!r) return { ok: false, message: 'No se encontró el registro.' };
    if (r.accion_actividad_id) {
      return { ok: false, message: 'Este registro ya tiene una actividad asignada.' };
    }
    if (!String(r.accion || '').trim()) {
      return { ok: false, message: 'Escribe primero la acción de tratamiento.' };
    }
    var responsable = String((data && data.responsable_email) || '').trim();
    if (!responsable) return { ok: false, message: 'Indica quién es responsable de la acción.' };
    var fecha = String((data && data.fecha_compromiso) || '').trim();
    if (!fecha) return { ok: false, message: 'Indica la fecha comprometida de la acción.' };

    var esOportunidad = r.clase === 'OPORTUNIDAD';
    var tarea = crearTareaSgc_({
      titulo: (esOportunidad ? 'Oportunidad ' : 'Riesgo ') + r.codigo + ': ' + String(r.factor || '').slice(0, 80),
      descripcion: r.accion + (r.medidas_control ? '\n\nControles: ' + r.medidas_control : ''),
      responsable_email: responsable,
      fecha_compromiso: fecha,
      origen_tipo: 'RIESGO_SGC',
      origen_id: r.riesgo_id
    }, contexto);

    if (!tarea || !tarea.actividad_id) {
      return { ok: false, message: (tarea && tarea.message) || 'No se pudo crear la actividad.' };
    }

    actualizarFilaPorId_(SHEETS.SGC_RIESGOS, 'riesgo_id', r.riesgo_id, {
      accion_actividad_id: tarea.actividad_id,
      responsable_email: responsable,
      estado: 'TRATADO'
    });
    registrarLogSgc_('SGC_RIESGO_ACCION_ASIGNADA',
      r.codigo + ' → actividad para ' + responsable, contexto);
    return { ok: true, actividad_id: tarea.actividad_id, message: 'Acción asignada a ' + responsable + '.' };
  },

  registrarRevision: function (data, contexto) {
    var rol = rolSgc_(contexto);
    if (!gobiernaSgc_(contexto, rol)) {
      return { _forbidden: true, message: 'Solo el Encargado del SGC puede registrar la revisión.' };
    }
    var filas = riesgosActivos_();
    if (!filas.length) return { ok: false, message: 'No hay nada que revisar todavía.' };

    var hoy = new Date().toISOString().slice(0, 10);
    var email = (contexto && contexto.email) || '';
    filas.forEach(function (r) {
      actualizarFilaPorId_(SHEETS.SGC_RIESGOS, 'riesgo_id', r.riesgo_id,
        { fecha_ultima_revision: hoy, revisado_por: email });
    });
    registrarLogSgc_('SGC_RIESGOS_REVISADOS', 'Matriz de riesgos revisada al ' + hoy, contexto);
    return { ok: true, message: 'Revisión registrada al ' + hoy + '.' };
  },

  anular: function (data, contexto) {
    var rol = rolSgc_(contexto);
    if (!gobiernaSgc_(contexto, rol)) {
      return { _forbidden: true, message: 'Solo el Encargado del SGC puede quitar registros.' };
    }
    var r = riesgosActivos_().filter(function (x) { return x.riesgo_id === data.riesgo_id; })[0];
    if (!r) return { ok: false, message: 'No se encontró el registro.' };
    actualizarFilaPorId_(SHEETS.SGC_RIESGOS, 'riesgo_id', r.riesgo_id, { activa: false });
    registrarLogSgc_('SGC_RIESGO_QUITADO', r.codigo + ' quitado de la matriz', contexto);
    return { ok: true, message: 'Registro quitado de la matriz.' };
  }
};

// --- calculo de la valoracion -----------------------------------------------

/**
 * magnitud = probabilidad x impacto, y la banda sale de la tabla de
 * criterios. Es la funcion central de la fase: mientras esto se calcule,
 * la etiqueta no puede contradecir al numero.
 */
function valorarRiesgo_(probabilidad, impacto) {
  var p = Number(probabilidad);
  var i = Number(impacto);
  if (!isFinite(p) || !isFinite(i) || p <= 0 || i <= 0) return null;
  // Redondeo defensivo a dos decimales. Con la escala actual del DOC-08
  // (3 probabilidades x 5 impactos) ninguna de las 15 combinaciones arrastra
  // decimales -- lo comprobe --, pero las bandas se deciden en bordes
  // exactos (2,5 · 10 · 25) y basta que la empresa agregue un 0,25 a la
  // escala para que un arrastre binario cambie de banda un valor limite.
  var magnitud = Math.round(p * i * 100) / 100;
  for (var k = 0; k < BANDAS_MAGNITUD.length; k++) {
    if (magnitud < BANDAS_MAGNITUD[k].hasta) {
      return { magnitud: magnitud, banda: BANDAS_MAGNITUD[k].etiqueta, tono: BANDAS_MAGNITUD[k].tono };
    }
  }
  var ultima = BANDAS_MAGNITUD[BANDAS_MAGNITUD.length - 1];
  return { magnitud: magnitud, banda: ultima.etiqueta, tono: ultima.tono };
}

/**
 * El tono del semaforo. En una OPORTUNIDAD el significado se invierte: una
 * magnitud alta es buena. Sin esto, media matriz se veria al reves.
 */
function tonoValoracion_(valoracion, clase) {
  if (!valoracion) return 'neutro';
  if (clase !== 'OPORTUNIDAD') return valoracion.tono;
  var INVERSO = { neutro: 'neutro', ok: 'neutro', info: 'info', alerta: 'ok', critico: 'ok' };
  return INVERSO[valoracion.tono] || 'neutro';
}

// --- helpers ----------------------------------------------------------------

function riesgosActivos_() {
  return leerFilasSeguro_(SHEETS.SGC_RIESGOS).filter(function (r) {
    return esVerdaderoSgc_(r.activa);
  });
}

function indiceFactoresPorCodigo_() {
  var indice = {};
  if (typeof factoresContextoActivos_ !== 'function') return indice;
  factoresContextoActivos_().forEach(function (f) {
    indice[String(f.tipo || '').slice(0, 1) + f.numero] = f.factor_id;
  });
  return indice;
}

function buscarActividadSgc_(actividadId) {
  if (!actividadId) return null;
  return leerFilasSeguro_(SHEETS.ACTIVIDADES).filter(function (a) {
    return a.actividad_id === actividadId;
  })[0] || null;
}

function siguienteCodigoRiesgo_(clase) {
  var prefijo = clase === 'OPORTUNIDAD' ? 'O' : 'R';
  var max = 0;
  riesgosActivos_().forEach(function (r) {
    if (r.clase !== clase) return;
    var n = parseInt(String(r.codigo || '').replace(/\D/g, ''), 10);
    if (isFinite(n) && n > max) max = n;
  });
  return prefijo + (max + 1);
}

function formatearRiesgo_(r, factorTexto, tarea) {
  var inherente = valorarRiesgo_(r.probabilidad, r.impacto);
  var residual = valorarRiesgo_(r.probabilidad_residual, r.impacto_residual);

  // Para un riesgo, tratar significa BAJAR la magnitud; para una
  // oportunidad, SUBIRLA. La misma comparacion con el signo cambiado.
  var mejora = null;
  if (inherente && residual) {
    mejora = r.clase === 'OPORTUNIDAD'
      ? residual.magnitud > inherente.magnitud
      : residual.magnitud < inherente.magnitud;
  }

  return {
    riesgo_id: r.riesgo_id,
    clase: r.clase,
    codigo: r.codigo,
    relacion_actividad: r.relacion_actividad || '',
    factor: r.factor || '',
    descripcion: r.descripcion || '',
    analisis_causa: r.analisis_causa || '',
    procedencia: r.procedencia || '',
    origen: r.origen || '',
    factor_contexto_id: r.factor_contexto_id || '',
    factor_contexto: factorTexto,
    probabilidad: Number(r.probabilidad) || 0,
    impacto: Number(r.impacto) || 0,
    inherente: inherente,
    tono_inherente: tonoValoracion_(inherente, r.clase),
    probabilidad_residual: Number(r.probabilidad_residual) || 0,
    impacto_residual: Number(r.impacto_residual) || 0,
    residual: residual,
    tono_residual: tonoValoracion_(residual, r.clase),
    mejora: mejora,
    // En una oportunidad, "favorable" invierte la lectura del semaforo.
    favorable: r.clase === 'OPORTUNIDAD',
    accion: r.accion || '',
    fecha_implementacion: r.fecha_implementacion || '',
    medidas_control: r.medidas_control || '',
    responsable_email: r.responsable_email || '',
    accion_actividad_id: r.accion_actividad_id || '',
    tarea: tarea,
    estado: r.estado || 'ABIERTO',
    observaciones: r.observaciones || '',
    fecha_identificacion: r.fecha_identificacion || '',
    fecha_ultima_revision: r.fecha_ultima_revision || '',
    revisado_por: r.revisado_por || ''
  };
}

function resumenRiesgos_(lista) {
  var riesgos = lista.filter(function (r) { return r.clase === 'RIESGO'; });
  var criticos = riesgos.filter(function (r) {
    return r.inherente && (r.inherente.banda === 'Crítico' || r.inherente.banda === 'Alto');
  });
  // "Sin tratar" mira el RESIDUAL, no la accion escrita: un riesgo alto con
  // una accion redactada pero sin revaloracion sigue estando sin tratar.
  var sinTratar = criticos.filter(function (r) { return !r.residual; });
  var sinAccion = riesgos.filter(function (r) { return !String(r.accion || '').trim(); });
  var conActividad = lista.filter(function (r) { return !!r.accion_actividad_id; });

  var fechas = lista
    .map(function (r) { return String(r.fecha_ultima_revision || '').slice(0, 10); })
    .filter(Boolean).sort();
  var ultima = fechas.length ? fechas[0] : '';
  var meses = (typeof mesesDesde_ === 'function') ? mesesDesde_(ultima) : null;

  return {
    total: lista.length,
    total_riesgos: riesgos.length,
    total_oportunidades: lista.length - riesgos.length,
    criticos_o_altos: criticos.length,
    sin_tratar: sinTratar.length,
    sin_accion: sinAccion.length,
    con_actividad: conActividad.length,
    ultima_revision: ultima,
    meses_desde_revision: meses,
    revision_vencida: meses !== null && meses >= MESES_REVISION_RIESGOS
  };
}

function validarRiesgo_(data) {
  var d = data || {};
  var clase = String(d.clase || 'RIESGO').trim().toUpperCase();
  if (CLASES_RIESGO.indexOf(clase) === -1) {
    return { error: 'Indica si es un riesgo o una oportunidad.' };
  }
  var descripcion = String(d.descripcion || '').trim();
  if (!descripcion) return { error: 'Describe el riesgo u oportunidad.' };
  var factor = String(d.factor || '').trim();
  if (!factor) return { error: 'Indica el factor: es el título corto con el que se identifica.' };

  var valores = PROBABILIDAD_RIESGO.map(function (p) { return p.valor; });
  var impactos = IMPACTO_RIESGO.map(function (i) { return i.valor; });

  var p = Number(d.probabilidad);
  if (valores.indexOf(p) === -1) {
    return { error: 'La probabilidad tiene que ser una de la escala: ' + valores.join(', ') + '.' };
  }
  var i = Number(d.impacto);
  if (impactos.indexOf(i) === -1) {
    return { error: 'El impacto tiene que ser uno de la escala: ' + impactos.join(', ') + '.' };
  }

  // La revaloracion es OPCIONAL: un riesgo recien identificado todavia no
  // la tiene. Pero si viene una, tiene que venir completa -- media
  // revaloracion no se puede calcular.
  var pr = d.probabilidad_residual === '' || d.probabilidad_residual === undefined || d.probabilidad_residual === null
    ? '' : Number(d.probabilidad_residual);
  var ir = d.impacto_residual === '' || d.impacto_residual === undefined || d.impacto_residual === null
    ? '' : Number(d.impacto_residual);
  if ((pr === '') !== (ir === '')) {
    return { error: 'La revaloración necesita probabilidad e impacto: con uno solo no se puede calcular la magnitud.' };
  }
  if (pr !== '' && valores.indexOf(pr) === -1) {
    return { error: 'La probabilidad residual tiene que ser una de la escala: ' + valores.join(', ') + '.' };
  }
  if (ir !== '' && impactos.indexOf(ir) === -1) {
    return { error: 'El impacto residual tiene que ser uno de la escala: ' + impactos.join(', ') + '.' };
  }

  var estado = String(d.estado || 'ABIERTO').trim().toUpperCase();
  if (ESTADOS_RIESGO.indexOf(estado) === -1) estado = 'ABIERTO';

  return {
    datos: {
      clase: clase,
      relacion_actividad: String(d.relacion_actividad || '').trim(),
      factor: factor,
      descripcion: descripcion,
      analisis_causa: String(d.analisis_causa || '').trim(),
      procedencia: String(d.procedencia || '').trim(),
      origen: String(d.origen || '').trim().toUpperCase() === 'EXTERNO' ? 'EXTERNO' : 'INTERNO',
      factor_contexto_id: String(d.factor_contexto_id || '').trim(),
      probabilidad: p,
      impacto: i,
      accion: String(d.accion || '').trim(),
      fecha_implementacion: String(d.fecha_implementacion || '').trim(),
      medidas_control: String(d.medidas_control || '').trim(),
      probabilidad_residual: pr,
      impacto_residual: ir,
      estado: estado,
      observaciones: String(d.observaciones || '').trim()
    }
  };
}
