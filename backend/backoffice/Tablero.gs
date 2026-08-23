/**
 * Tablero.gs — v11.0 Fase 7: el centro de control del SGC.
 *
 * Va al final del plan a proposito: un tablero solo puede mostrar lo que las
 * fases anteriores producen. Con las seis primeras hechas, ya hay de que
 * hablar -- alcance, contexto, riesgos, procesos, documentos, indicadores,
 * NC, auditorias, quejas, proveedores y revision por la direccion.
 *
 * Cuatro decisiones:
 *
 * 1. NO hay un porcentaje nuevo. El % de salud es el MISMO que calcula la
 *    matriz de cobertura, reusado. Dos numeros distintos llamados "avance
 *    del SGC" en el mismo producto es exactamente lo que hace que nadie
 *    confie en ninguno.
 *
 * 2. La salud se agrupa POR CAPITULO DE LA NORMA (4 a 10), no por
 *    dimensiones inventadas. El capitulo es la estructura que el auditor ya
 *    conoce y la que la propia norma usa.
 *
 * 3. Se declara explicito que es un INDICADOR INTERNO DE GESTION. No es un
 *    porcentaje oficial de certificacion ni existe tal cosa: quien certifica
 *    es la casa certificadora, y lo hace con hallazgos, no con un numero.
 *
 * 4. Las alertas son ACCIONABLES: cada una sabe a que seccion lleva. Una
 *    lista de problemas sin el camino para resolverlos es una lista de
 *    reproches.
 *
 * Sin hojas nuevas: todo se calcula en el momento.
 */

var SEVERIDAD_ALERTA = { CRITICA: 'CRITICA', ALTA: 'ALTA', MEDIA: 'MEDIA' };

// Dias de anticipacion con que se avisa de algo que vence.
var DIAS_AVISO_TABLERO = 60;

// Los capitulos auditables de la norma, con las clausulas que los componen.
// El catalogo de clausulas ya existe (CLAUSULAS_ISO9001): esto solo dice a
// que capitulo pertenece cada una, que es como se agrupa en la portada.
var CAPITULOS_ISO = [
  { numero: '4', titulo: 'Contexto de la organización' },
  { numero: '5', titulo: 'Liderazgo' },
  { numero: '6', titulo: 'Planificación' },
  { numero: '7', titulo: 'Apoyo' },
  { numero: '8', titulo: 'Operación' },
  { numero: '9', titulo: 'Evaluación del desempeño' },
  { numero: '10', titulo: 'Mejora' }
];

var Tablero = {

  /**
   * Una sola llamada devuelve todo lo que la portada necesita. Cada hoja se
   * lee UNA vez y se reparte: el limite de 6 minutos de Apps Script no
   * perdona un tablero que consulte la misma hoja cinco veces.
   */
  resumen: function (data, contexto) {
    var rol = rolSgc_(contexto);
    var gobierna = gobiernaSgc_(contexto, rol);
    if (!(gobierna || veTodoSgc_(contexto, rol, gobierna))) {
      return { _forbidden: true, message: 'El tablero del SGC es para quien gobierna o supervisa el sistema.' };
    }

    var hoy = new Date();
    var hoyClave = hoy.toISOString().slice(0, 10);
    var limiteAviso = new Date(hoy.getTime() + DIAS_AVISO_TABLERO * 86400000).toISOString().slice(0, 10);

    // --- una lectura por hoja -------------------------------------------
    var docs = leerFilasSeguro_(SHEETS.SGC_DOCUMENTOS).filter(esActivoSgc_);
    var acuses = leerFilasSeguro_(SHEETS.SGC_DOC_ACUSES);
    var destinatarios = leerFilasSeguro_(SHEETS.SGC_DOC_DESTINATARIOS);
    var ncs = leerFilasSeguro_(SHEETS.SGC_NC).filter(esActivoSgc_);
    var auditorias = leerFilasSeguro_(SHEETS.SGC_AUDITORIAS).filter(esActivoSgc_);
    var revisiones = leerFilasSeguro_(SHEETS.SGC_REVISIONES).filter(esActivoSgc_);
    var quejas = leerFilasSeguro_(SHEETS.SGC_QUEJAS).filter(esActivoSgc_);
    var riesgos = leerFilasSeguro_(SHEETS.SGC_RIESGOS).filter(esActivoSgc_);
    var procesos = leerFilasSeguro_(SHEETS.SGC_PROCESOS).filter(esActivoSgc_);
    var contextoFilas = leerFilasSeguro_(SHEETS.SGC_CONTEXTO).filter(esActivoSgc_);
    var partes = leerFilasSeguro_(SHEETS.SGC_PARTES_INTERESADAS).filter(esActivoSgc_);
    var indicadores = leerFilasSeguro_(SHEETS.SGC_INDICADORES).filter(esActivoSgc_);
    var lecturas = leerFilasSeguro_(SHEETS.SGC_INDICADOR_LECTURAS).filter(esActivoSgc_);
    var evaluaciones = leerFilasSeguro_(SHEETS.SGC_EVALUACIONES);
    var provEval = leerFilasSeguro_(SHEETS.SGC_PROVEEDOR_EVALUACIONES);
    var proveedores = leerFilasSeguro_(SHEETS.SGC_PROVEEDORES).filter(esActivoSgc_);
    var alcance = (typeof alcanceVigente_ === 'function') ? alcanceVigente_() : null;

    var alertas = [];
    var hitos = [];

    function alerta(sev, titulo, detalle, seccion, total) {
      if (!total) return;
      alertas.push({ severidad: sev, titulo: titulo, detalle: detalle, seccion: seccion, total: total });
    }
    function hito(fecha, titulo, seccion) {
      var f = String(fecha || '').slice(0, 10);
      if (!f || f < hoyClave) return;
      hitos.push({ fecha: f, titulo: titulo, seccion: seccion });
    }

    // --- documentos ------------------------------------------------------
    var vigentes = docs.filter(function (d) { return d.estado === 'VIGENTE'; });
    var docsVencidos = vigentes.filter(function (d) {
      var p = String(d.proxima_revision || '').slice(0, 10);
      return p && p < hoyClave;
    });
    var docsPorVencer = vigentes.filter(function (d) {
      var p = String(d.proxima_revision || '').slice(0, 10);
      return p && p >= hoyClave && p <= limiteAviso;
    });
    alerta(SEVERIDAD_ALERTA.CRITICA, 'Documentos con la revisión vencida',
      'Su fecha de próxima revisión ya pasó: para el auditor, un documento sin revisar en plazo es información documentada fuera de control.',
      'documentos', docsVencidos.length);
    alerta(SEVERIDAD_ALERTA.MEDIA, 'Documentos por revisar',
      'Vencen dentro de los próximos ' + DIAS_AVISO_TABLERO + ' días.',
      'documentos', docsPorVencer.length);
    docsPorVencer.slice(0, 10).forEach(function (d) {
      hito(d.proxima_revision, 'Revisar ' + d.codigo + ' — ' + d.nombre, 'documentos');
    });

    // Acuses pendientes con el plazo pasado.
    var acusadoPor = {};
    acuses.forEach(function (a) { acusadoPor[a.documento_id + '|' + a.version + '|' + normalizarEmailSgc_(a.usuario_email)] = true; });
    var acusesVencidos = 0;
    vigentes.forEach(function (d) {
      if (!esVerdaderoSgc_(d.requiere_acuse)) return;
      var limite = String(d.fecha_limite_acuse || '').slice(0, 10);
      if (!limite || limite >= hoyClave) return;
      destinatarios.filter(function (x) { return x.documento_id === d.documento_id; }).forEach(function (x) {
        if (!acusadoPor[d.documento_id + '|' + d.version_vigente + '|' + normalizarEmailSgc_(x.email)]) acusesVencidos++;
      });
    });
    alerta(SEVERIDAD_ALERTA.ALTA, 'Confirmaciones de lectura fuera de plazo',
      'Personas que no confirmaron haber leído un documento que ya venció su plazo (§7.5.3).',
      'documentos', acusesVencidos);

    // --- no conformidades ------------------------------------------------
    var ncAbiertas = ncs.filter(function (n) { return n.estado !== 'CERRADA'; });
    var ncVencidas = ncAbiertas.filter(function (n) {
      return [n.correccion_plazo, n.accion_plazo, n.eficacia_plazo].some(function (p) {
        var f = String(p || '').slice(0, 10);
        return f && f < hoyClave;
      });
    });
    alerta(SEVERIDAD_ALERTA.CRITICA, 'No conformidades con plazo vencido',
      'Alguna de sus etapas (corrección, acción correctiva o verificación de eficacia) pasó su fecha.',
      'nc', ncVencidas.length);
    alerta(SEVERIDAD_ALERTA.ALTA, 'No conformidades abiertas',
      'En curso, dentro de plazo.', 'nc', ncAbiertas.length - ncVencidas.length);
    ncAbiertas.forEach(function (n) {
      [[n.correccion_plazo, 'corrección'], [n.accion_plazo, 'acción correctiva'], [n.eficacia_plazo, 'verificación de eficacia']]
        .forEach(function (par) {
          hito(par[0], n.correlativo + ': ' + par[1], 'nc');
        });
    });

    // --- quejas -----------------------------------------------------------
    var quejasAbiertas = quejas.filter(function (q) { return q.estado !== 'CERRADA'; });
    var quejasVencidas = quejasAbiertas.filter(function (q) {
      return [q.resolucion_plazo, q.seguimiento_plazo].some(function (p) {
        var f = String(p || '').slice(0, 10);
        return f && f < hoyClave;
      });
    });
    alerta(SEVERIDAD_ALERTA.CRITICA, 'Quejas fuera de plazo',
      'El PRO-07 compromete responder en 30 días corridos.', 'quejas', quejasVencidas.length);
    alerta(SEVERIDAD_ALERTA.ALTA, 'Quejas en curso',
      'Dentro de plazo.', 'quejas', quejasAbiertas.length - quejasVencidas.length);
    quejasAbiertas.forEach(function (q) {
      hito(q.resolucion_plazo, q.correlativo + ': responder al cliente', 'quejas');
    });

    // --- riesgos ----------------------------------------------------------
    var riesgosAltos = riesgos.filter(function (r) {
      if (r.clase === 'OPORTUNIDAD') return false;
      var v = (typeof valorarRiesgo_ === 'function') ? valorarRiesgo_(r.probabilidad, r.impacto) : null;
      return v && (v.banda === 'Alto' || v.banda === 'Crítico');
    });
    var riesgosSinTratar = riesgosAltos.filter(function (r) {
      return !(typeof valorarRiesgo_ === 'function' && valorarRiesgo_(r.probabilidad_residual, r.impacto_residual));
    });
    alerta(SEVERIDAD_ALERTA.CRITICA, 'Riesgos altos o críticos sin revalorar',
      'Tienen acción definida pero nadie ha vuelto a valorarlos tras los controles: no hay evidencia de que se hayan abordado.',
      'riesgos', riesgosSinTratar.length);

    // --- auditorías --------------------------------------------------------
    var auditoriasPendientes = auditorias.filter(function (a) { return !a.fecha_ejecucion; });
    var auditoriasAtrasadas = auditoriasPendientes.filter(function (a) {
      var f = String(a.fecha_programada || '').slice(0, 10);
      return f && f < hoyClave;
    });
    alerta(SEVERIDAD_ALERTA.ALTA, 'Auditorías programadas y no ejecutadas',
      'Su fecha programada ya pasó.', 'auditorias', auditoriasAtrasadas.length);
    auditoriasPendientes.forEach(function (a) {
      hito(a.fecha_programada, 'Auditoría ' + (a.correlativo || a.anio), 'auditorias');
    });
    // Informes de auditoría fuera de plazo (PRO-03: 10 días hábiles).
    var informesAtrasados = auditorias.filter(function (a) {
      if (!a.fecha_ejecucion || a.informe_fecha) return false;
      var f = String(a.informe_plazo || '').slice(0, 10);
      return f && f < hoyClave;
    });
    alerta(SEVERIDAD_ALERTA.ALTA, 'Informes de auditoría fuera de plazo',
      'La auditoría se ejecutó pero su informe no se emitió dentro del plazo del PRO-03.',
      'auditorias', informesAtrasados.length);

    // --- revisión por la dirección ----------------------------------------
    var revisionesAbiertas = revisiones.filter(function (r) { return r.estado !== 'CERRADA'; });
    revisionesAbiertas.forEach(function (r) {
      hito(r.fecha_programada, 'Revisión por la dirección ' + (r.correlativo || r.anio), 'revision');
    });
    var ultimaRevision = revisiones.filter(function (r) { return r.estado === 'CERRADA' && r.fecha_cierre; })
      .map(function (r) { return String(r.fecha_cierre).slice(0, 10); }).sort().pop() || '';
    var mesesRevision = (typeof mesesDesde_ === 'function') ? mesesDesde_(ultimaRevision) : null;
    if (!revisiones.length) {
      alerta(SEVERIDAD_ALERTA.ALTA, 'Sin revisión por la dirección registrada',
        '§9.3 la exige a intervalos planificados.', 'revision', 1);
    } else if (mesesRevision !== null && mesesRevision >= 12) {
      alerta(SEVERIDAD_ALERTA.ALTA, 'La revisión por la dirección lleva ' + mesesRevision + ' meses',
        'La frecuencia definida es anual.', 'revision', 1);
    }

    // --- personas ----------------------------------------------------------
    var evalVencidas = evaluaciones.filter(function (e) {
      var f = String(e.proxima_evaluacion || '').slice(0, 10);
      return f && f < hoyClave;
    });
    alerta(SEVERIDAD_ALERTA.MEDIA, 'Evaluaciones de competencia vencidas',
      'Su próxima evaluación ya debía haberse hecho (§7.2).', 'personas', evalVencidas.length);
    evaluaciones.forEach(function (e) { hito(e.proxima_evaluacion, 'Reevaluar competencias', 'personas'); });

    // --- proveedores -------------------------------------------------------
    var evaluadoHasta = {};
    provEval.forEach(function (e) {
      var f = String(e.proxima_evaluacion || '').slice(0, 10);
      if (!evaluadoHasta[e.proveedor_id] || f > evaluadoHasta[e.proveedor_id]) evaluadoHasta[e.proveedor_id] = f;
    });
    var provVencidos = proveedores.filter(function (p) {
      var f = evaluadoHasta[p.proveedor_id];
      // Nunca evaluado tambien cuenta como vencido: es el criterio que ya
      // usa el modulo de proveedores desde la Fase 5a.
      return !f || f < hoyClave;
    });
    alerta(SEVERIDAD_ALERTA.MEDIA, 'Proveedores sin evaluación vigente',
      'Nunca evaluados o con la reevaluación vencida (§8.4).', 'proveedores', provVencidos.length);

    // --- medición ----------------------------------------------------------
    var indSinMedir = indicadores.filter(function (i) {
      return !lecturas.some(function (l) { return l.indicador_id === i.indicador_id; });
    });
    alerta(SEVERIDAD_ALERTA.MEDIA, 'Indicadores definidos y nunca medidos',
      'Definir el indicador no es medirlo (§9.1.1).', 'indicadores', indSinMedir.length);
    var indNoCumplen = indicadores.filter(function (i) {
      var propias = lecturas.filter(function (l) { return l.indicador_id === i.indicador_id; })
        .sort(function (a, b) { return String(a.periodo).localeCompare(String(b.periodo)); });
      var ultima = propias[propias.length - 1];
      return ultima && ultima.origen === 'NO_CUMPLE';
    });
    alerta(SEVERIDAD_ALERTA.ALTA, 'Indicadores bajo meta',
      'Su última medición quedó fuera incluso de la tolerancia.', 'indicadores', indNoCumplen.length);

    // --- planificación al día ---------------------------------------------
    if (!alcance) {
      alerta(SEVERIDAD_ALERTA.CRITICA, 'El alcance del SGC no está declarado',
        'Es lo primero que pide una auditoría de certificación (§4.3).', 'alcance', 1);
    }
    if (!contextoFilas.length) {
      alerta(SEVERIDAD_ALERTA.ALTA, 'El análisis de contexto no está cargado',
        '§4.1 exige determinar las cuestiones internas y externas.', 'contexto', 1);
    }
    if (!partes.length) {
      alerta(SEVERIDAD_ALERTA.ALTA, 'Las partes interesadas no están determinadas',
        '§4.2.', 'contexto', 1);
    }
    if (!riesgos.length) {
      alerta(SEVERIDAD_ALERTA.ALTA, 'La matriz de riesgos no está cargada',
        '§6.1.', 'riesgos', 1);
    }
    if (!procesos.length) {
      alerta(SEVERIDAD_ALERTA.ALTA, 'El mapa de procesos no está cargado',
        '§4.4.', 'procesos', 1);
    }
    var procesosMapa = procesos.filter(function (p) { return p.nivel === 'MAPA'; });
    var procesosSinResponsable = procesosMapa.filter(function (p) { return !String(p.responsable_email || '').trim(); });
    alerta(SEVERIDAD_ALERTA.MEDIA, 'Procesos sin responsable asignado',
      '§4.4.2 e) pide asignar la responsabilidad y autoridad de cada proceso.',
      'procesos', procesosSinResponsable.length);

    // --- salud por capítulo, reusando la matriz de cobertura ---------------
    var matriz = MatrizCobertura.listar({}, contexto);
    var salud = saludPorCapitulo_(matriz.clausulas || []);

    var orden = { CRITICA: 0, ALTA: 1, MEDIA: 2 };
    alertas.sort(function (a, b) { return orden[a.severidad] - orden[b.severidad]; });
    hitos.sort(function (a, b) { return a.fecha.localeCompare(b.fecha); });

    return {
      puede_gestionar: gobierna,
      // El tablero es ahora la primera pantalla del modulo, asi que tiene
      // que traer el mapa de secciones: antes solo llegaba con listarDocumentos
      // y la barra se pintaba sin saber que puede abrir cada quien.
      secciones_visibles: seccionesVisiblesSgc_(contexto),
      fecha: hoyClave,
      alcance: alcance ? {
        version: alcance.version,
        razon_social: alcance.razon_social,
        nombre_fantasia: alcance.nombre_fantasia,
        norma: (alcance.norma_codigo || '') + ':' + (alcance.norma_version || ''),
        declaracion: alcance.declaracion
      } : null,
      salud: {
        // El MISMO numero de la matriz de cobertura, no uno nuevo.
        pct: (matriz.resumen && matriz.resumen.pct_listo) || 0,
        aplicables: (matriz.resumen && matriz.resumen.aplicables) || 0,
        no_aplica: (matriz.resumen && matriz.resumen.no_aplica) || 0,
        capitulos: salud,
        // Se manda para que la pantalla no pueda "olvidarse" de decirlo.
        aviso: 'Indicador interno de gestión: mide cuánta evidencia hay cargada en SIGSO, ' +
          'no es un porcentaje oficial de certificación. Quien certifica es la casa certificadora, ' +
          'y lo hace con hallazgos.'
      },
      alertas: alertas,
      hitos: hitos.slice(0, 15),
      conteos: {
        documentos_vigentes: vigentes.length,
        documentos_externos: vigentes.filter(function (d) { return d.tipo === 'EXTERNO'; }).length,
        nc_abiertas: ncAbiertas.length,
        quejas_abiertas: quejasAbiertas.length,
        riesgos: riesgos.filter(function (r) { return r.clase !== 'OPORTUNIDAD'; }).length,
        riesgos_altos: riesgosAltos.length,
        procesos_mapa: procesosMapa.length,
        procesos_servicio: procesos.length - procesosMapa.length,
        indicadores: indicadores.length,
        auditorias_ejecutadas: auditorias.filter(function (a) { return !!a.fecha_ejecucion; }).length,
        ultima_revision_direccion: ultimaRevision
      }
    };
  }
};

/**
 * Agrupa el estado de las 28 clausulas por capitulo de la norma. Se usa el
 * capitulo y no dimensiones propias porque es la estructura que el auditor
 * ya conoce y con la que va a recorrer el sistema.
 *
 * El porcentaje de cada capitulo sigue la misma regla que el global: una
 * clausula PARCIAL vale medio punto, y una NO_APLICA sale del denominador.
 */
function saludPorCapitulo_(clausulas) {
  return CAPITULOS_ISO.map(function (cap) {
    var propias = clausulas.filter(function (c) {
      return String(c.codigo).split('.')[0] === cap.numero;
    });
    var completo = propias.filter(function (c) { return c.estado === 'COMPLETO'; }).length;
    var parcial = propias.filter(function (c) { return c.estado === 'PARCIAL'; }).length;
    var noAplica = propias.filter(function (c) { return c.estado === 'NO_APLICA'; }).length;
    var aplicables = propias.length - noAplica;
    return {
      numero: cap.numero,
      titulo: cap.titulo,
      total: propias.length,
      aplicables: aplicables,
      completo: completo,
      parcial: parcial,
      faltante: aplicables - completo - parcial,
      no_aplica: noAplica,
      pct: aplicables ? Math.round(((completo + parcial * 0.5) / aplicables) * 100) : 0
    };
  });
}
