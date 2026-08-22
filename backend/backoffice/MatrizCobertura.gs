/**
 * MatrizCobertura.gs — v10.0 Fase 6b: matriz de cobertura ISO 9001 + "modo
 * auditoría" (mejora propuesta, no está en la especificación original —
 * §F.1/F.2 de la propuesta de arquitectura).
 *
 * La pregunta que este modulo responde es la que hoy nadie puede contestar
 * con datos: "¿estamos listos para la auditoria de certificacion?". Recorre
 * las 28 clausulas auditables (mismo catalogo que Auditorias.gs, no una
 * copia) y por cada una mira si el sistema tiene evidencia real -- no una
 * opinion, un conteo.
 *
 * Tres decisiones de diseno:
 *
 * 1. NO se inventan nuevas hojas de "cobertura". El estado de cada clausula
 *    se CALCULA en el momento a partir de datos que ya existen (NC,
 *    auditorias, proveedores, revisiones, personas, objetivos...). Guardar
 *    un "estado" en una hoja aparte se desincroniza el primer dia que
 *    alguien cierra una NC y nadie actualiza la matriz.
 *
 * 2. Las clausulas cuya evidencia es un DOCUMENTO especifico (4.3 alcance,
 *    4.4 mapa de procesos, 5.2 politica de calidad...) NO se detectan por
 *    palabras clave en el nombre -- seria adivinar. En vez de eso,
 *    SGC_DOCUMENTOS gano un campo `clausulas_iso` (Fase 6b) que el
 *    Encargado SGC llena al cargar o editar un documento: el que sabe cual
 *    de sus DOC-01..13 es la politica de calidad es la empresa, no SIGSO.
 *
 * 3. Tres estados, no dos. FALTANTE no es lo mismo que "no aplica" ni que
 *    "esta fuera del alcance de SIGSO hoy" (evidencia de servicios, Fase 7).
 *    Cada clausula sin evidencia trae una nota que dice POR QUE: modulo que
 *    falta, o simplemente que nadie la ha taggeado todavia.
 */

// Umbral para pasar de PARCIAL a COMPLETO en las clausulas medidas por
// cobertura de personas (7.2, 7.3): bajo este porcentaje la evidencia existe
// pero es floja -- alcanza para PARCIAL, no para decir que esta resuelto.
var UMBRAL_COBERTURA_COMPLETO = 0.8;

var MatrizCobertura = {

  listar: function (data, contexto) {
    var rol = rolSgc_(contexto);
    var gobierna = gobiernaSgc_(contexto, rol);
    if (!(gobierna || veTodoSgc_(contexto, rol, gobierna))) {
      return { _forbidden: true, message: 'No tienes acceso a la matriz de cobertura ISO.' };
    }

    var excluidas = exclusionesVigentesPorClausula_();

    var clausulas = CLAUSULAS_ISO9001.map(function (c) {
      var r = evaluarClausula_(c.codigo, excluidas);
      return {
        codigo: c.codigo,
        titulo: c.titulo,
        estado: r.estado,
        resumen: r.resumen,
        total_evidencia: r.evidencia.length,
        exclusiones: (excluidas[c.codigo] || []).length
      };
    });

    // NO_APLICA sale del denominador. Contarla como faltante castigaria a la
    // organizacion por una exclusion legitima; contarla como completa le
    // regalaria un punto que no trabajo. Sale del calculo y se informa aparte.
    var resumen = { total: clausulas.length, completo: 0, parcial: 0, faltante: 0, no_aplica: 0 };
    clausulas.forEach(function (c) {
      if (c.estado === 'NO_APLICA') resumen.no_aplica++;
      else if (c.estado === 'COMPLETO') resumen.completo++;
      else if (c.estado === 'PARCIAL') resumen.parcial++;
      else resumen.faltante++;
    });
    var aplicables = resumen.total - resumen.no_aplica;
    resumen.aplicables = aplicables;
    resumen.pct_listo = aplicables
      ? Math.round(((resumen.completo + resumen.parcial * 0.5) / aplicables) * 100)
      : 0;

    return {
      puede_gestionar: gobierna,
      resumen: resumen,
      clausulas: clausulas,
      norma: normaDeclarada_()
    };
  },

  getDetalle: function (data, contexto) {
    var rol = rolSgc_(contexto);
    var gobierna = gobiernaSgc_(contexto, rol);
    if (!(gobierna || veTodoSgc_(contexto, rol, gobierna))) {
      return { _forbidden: true, message: 'No tienes acceso a la matriz de cobertura ISO.' };
    }
    var codigo = String((data && data.codigo) || '').trim();
    var clausula = CLAUSULAS_ISO9001.filter(function (c) { return c.codigo === codigo; })[0];
    if (!clausula) return errorValidacion_('codigo', 'Cláusula no encontrada.');

    var excluidas = exclusionesVigentesPorClausula_();
    var r = evaluarClausula_(codigo, excluidas);
    return {
      codigo: clausula.codigo,
      titulo: clausula.titulo,
      estado: r.estado,
      resumen: r.resumen,
      nota: r.nota,
      evidencia: r.evidencia,
      exclusiones: excluidas[codigo] || [],
      norma: normaDeclarada_()
    };
  },

  // "Modo auditoria": arma el paquete de evidencia de una clausula como PDF
  // -- documentos vigentes, registros, fechas y responsables -- para que el
  // auditor lo pida y salga en un clic, no en una busqueda de una hora.
  descargarEvidencia: function (data, contexto) {
    var rol = rolSgc_(contexto);
    var gobierna = gobiernaSgc_(contexto, rol);
    if (!(gobierna || veTodoSgc_(contexto, rol, gobierna))) {
      return { _forbidden: true, message: 'No tienes acceso a la matriz de cobertura ISO.' };
    }
    var codigo = String((data && data.codigo) || '').trim();
    var clausula = CLAUSULAS_ISO9001.filter(function (c) { return c.codigo === codigo; })[0];
    if (!clausula) return errorValidacion_('codigo', 'Cláusula no encontrada.');

    var r = evaluarClausula_(codigo);
    var html = construirHtmlEvidenciaClausula_(clausula, r);
    var pdf = Utilities.newBlob(html, 'text/html', 'Evidencia-' + codigo + '.html').getAs('application/pdf');
    pdf.setName('SIGSO-Evidencia-' + codigo + '.pdf');
    return { pdf_base64: Utilities.base64Encode(pdf.getBytes()), filename: pdf.getName() };
  }
};

// --- evaluadores por clausula -------------------------------------------------

// Cada evaluador devuelve {estado, resumen, nota, evidencia:[{tipo,
// descripcion, fecha, responsable, enlace}]}. `enlace` es solo informativo
// (id interno); el frontend no navega ahi todavia, es para que el auditor
// vea que el registro tiene una referencia concreta, no un texto suelto.
var EVALUADORES_CLAUSULA_ISO = {

  '5.3': function () { return evaluarPorDocumentos_('5.3'); },
  '6.1': function () { return evaluarRiesgosOportunidades_(); },
  '8.1': function () {
    return evaluarOperacionPorProcesos_('8.1',
      'La planificación está definida, pero falta la evidencia de ejecución por cliente y período (Fase 8).');
  },
  '8.5': function () {
    return evaluarOperacionPorProcesos_('8.5',
      'La prestación está definida, pero falta el registro de cada servicio efectivamente prestado (Fase 8).');
  },
  '8.6': function () {
    return evaluarOperacionPorProcesos_('8.6',
      'La liberación está definida en los pasos de cada proceso, pero falta el registro de cada liberación (Fase 8).');
  },
  '4.1': function () { return evaluarContextoOrganizacion_(); },
  '4.2': function () { return evaluarPartesInteresadas_(); },
  '4.3': function () { return evaluarAlcanceDeclarado_(); },
  // v11.0 Fase 1. Era la unica de las 28 sin evaluador NI nota: caia al
  // texto generico y al auditor le aparecia 'sin evidencia' sin decirle por
  // que, mientras las otras diez si explicaban su situacion.
  //
  // El liderazgo no se declara, se demuestra. La norma (§5.1.1) pide que la
  // alta direccion rinda cuentas del SGC, y su evidencia natural ya esta en
  // el sistema: la revision por la direccion, la politica aprobada y unos
  // objetivos que efectivamente se miden. Un acta cerrada vale mas que
  // cualquier declaracion de compromiso.
  '5.1': function () {
    var revisiones = leerFilasSeguro_(SHEETS.SGC_REVISIONES).filter(function (r) {
      return esVerdaderoSgc_(r.activa) && r.estado === 'CERRADA';
    });
    var politica = evaluarPorDocumentos_('5.2');
    var objetivos = EVALUADORES_CLAUSULA_ISO['6.2']();

    var ev = [];
    revisiones.slice(0, 5).forEach(function (r) {
      ev.push({ tipo: 'Revisión por la dirección cerrada', descripcion: r.correlativo,
        fecha: r.fecha_cierre, responsable: r.responsable_calidad_email });
    });
    politica.evidencia.forEach(function (e) { ev.push(e); });

    // Los tres pilares: la direccion revisa, aprobo una politica y hay
    // objetivos medidos. Con los tres, completo; con alguno, parcial.
    var pilares = (revisiones.length ? 1 : 0) +
      (politica.estado === 'COMPLETO' ? 1 : 0) +
      (objetivos.estado === 'FALTANTE' ? 0 : 1);

    var faltan = [];
    if (!revisiones.length) faltan.push('no hay revisiones por la dirección cerradas');
    if (politica.estado !== 'COMPLETO') faltan.push('la política de calidad no está etiquetada como documento de 5.2');
    if (objetivos.estado === 'FALTANTE') faltan.push('no hay objetivos de calidad con medición');

    return {
      estado: pilares === 3 ? 'COMPLETO' : (pilares ? 'PARCIAL' : 'FALTANTE'),
      resumen: revisiones.length + ' revisión(es) por la dirección cerradas; política y objetivos como respaldo.',
      nota: faltan.length
        ? 'La alta dirección demuestra su compromiso con hechos registrados: ' + faltan.join('; ') + '.'
        : '',
      evidencia: ev
    };
  },
  '4.4': function () { return evaluarProcesosSgc_(); },
  '5.2': function () { return evaluarPorDocumentos_('5.2'); },
  '7.4': function () {
    // Comunicacion interna: Novedades publicadas es evidencia de que la
    // organizacion efectivamente comunica, no solo lo declara.
    var publicadas = leerFilasSeguro_(SHEETS.NOVEDADES).filter(function (n) {
      return esVerdaderoSgc_(n.activa) && n.estado === 'PUBLICADA';
    });
    var ev = publicadas.slice(-10).map(function (n) {
      return { tipo: 'Novedad publicada', descripcion: n.titulo, fecha: n.fecha_publicacion, responsable: n.autor_nombre || n.autor_email };
    });
    return {
      estado: publicadas.length >= 3 ? 'COMPLETO' : (publicadas.length ? 'PARCIAL' : 'FALTANTE'),
      resumen: publicadas.length + ' comunicaciones publicadas (Novedades).',
      nota: publicadas.length ? '' : 'Sin comunicaciones publicadas todavía en Novedades.',
      evidencia: ev
    };
  },
  '7.5': function () {
    // Informacion documentada: el nucleo del Modulo 1. Vigentes con acuse
    // exigido y confirmado es la evidencia mas fuerte de §7.5.3.
    var docs = leerFilasSeguro_(SHEETS.SGC_DOCUMENTOS).filter(function (d) {
      return esVerdaderoSgc_(d.activa) && d.estado === 'VIGENTE';
    });
    var ev = docs.slice(0, 15).map(function (d) {
      return { tipo: 'Documento vigente', descripcion: d.codigo + ' — ' + d.nombre, fecha: d.fecha_vigencia, responsable: d.aprobado_por };
    });
    return {
      estado: docs.length >= 5 ? 'COMPLETO' : (docs.length ? 'PARCIAL' : 'FALTANTE'),
      resumen: docs.length + ' documentos vigentes en el listado maestro.',
      nota: docs.length ? '' : 'No hay documentos vigentes cargados.',
      evidencia: ev
    };
  },
  '6.2': function () {
    // Objetivos de calidad: sembrados y con lecturas es la evidencia fuerte.
    // Se mira el año MAS RECIENTE ya abierto (no necesariamente el año en
    // curso): si la empresa todavia no abrio el año nuevo en enero, la
    // matriz no tiene por que decir FALTANTE de un dia para otro.
    var todos = leerFilasSeguro_(SHEETS.SGC_OBJETIVOS).filter(esActivoSgc_);
    if (!todos.length) {
      return { estado: 'FALTANTE', resumen: 'No hay ningún año de objetivos abierto.', nota: 'Abrir el año en Objetivos de calidad.', evidencia: [] };
    }
    var anio = todos.reduce(function (max, o) { return Math.max(max, Number(o.anio)); }, 0);
    var objetivos = todos.filter(function (o) { return Number(o.anio) === anio; });
    var lecturas = leerFilasSeguro_(SHEETS.SGC_INDICADOR_LECTURAS).filter(function (l) { return esVerdaderoSgc_(l.activa); });
    var medidos = objetivos.filter(function (o) {
      return lecturas.some(function (l) { return l.objetivo_id === o.objetivo_id; });
    });
    var ev = objetivos.map(function (o) {
      var l = lecturas.filter(function (x) { return x.objetivo_id === o.objetivo_id; }).sort(function (a, b) { return String(a.periodo).localeCompare(String(b.periodo)); }).pop();
      return {
        tipo: 'Objetivo de calidad', descripcion: o.objetivo_general,
        fecha: l ? l.fecha_registro : '', responsable: o.responsable_texto
      };
    });
    return {
      estado: medidos.length === objetivos.length ? 'COMPLETO' : (medidos.length ? 'PARCIAL' : 'FALTANTE'),
      resumen: medidos.length + ' de ' + objetivos.length + ' objetivos con al menos una medición en ' + anio + '.',
      nota: '',
      evidencia: ev
    };
  },
  '7.2': function () {
    // Competencia: descriptor vigente + evaluacion, por persona activa.
    var personas = leerFilasSeguro_(SHEETS.SGC_PERSONAS).filter(function (p) {
      return esVerdaderoSgc_(p.activa) && p.estado !== 'DESVINCULADO';
    });
    if (!personas.length) return { estado: 'FALTANTE', resumen: 'No hay personal cargado.', nota: '', evidencia: [] };
    var descriptores = leerFilasSeguro_(SHEETS.SGC_DESCRIPTORES).filter(function (d) { return esVerdaderoSgc_(d.vigente); });
    // SGC_EVALUACIONES no tiene columna 'activa' (no es un registro que se
    // dé de baja, cada evaluacion queda como historico) -- no filtrar por
    // ella.
    var evaluaciones = leerFilasSeguro_(SHEETS.SGC_EVALUACIONES);
    var conAmbos = personas.filter(function (p) {
      return descriptores.some(function (d) { return d.persona_id === p.persona_id; }) &&
        evaluaciones.some(function (e) { return e.persona_id === p.persona_id; });
    });
    var pct = conAmbos.length / personas.length;
    var ev = conAmbos.slice(0, 15).map(function (p) {
      var ultima = evaluaciones.filter(function (e) { return e.persona_id === p.persona_id; })
        .sort(function (a, b) { return new Date(b.fecha || 0) - new Date(a.fecha || 0); })[0];
      return { tipo: 'Competencia evaluada', descripcion: p.nombre, fecha: ultima ? ultima.fecha : '', responsable: ultima ? ultima.evaluador_email : '' };
    });
    return {
      estado: pct >= UMBRAL_COBERTURA_COMPLETO ? 'COMPLETO' : (conAmbos.length ? 'PARCIAL' : 'FALTANTE'),
      resumen: conAmbos.length + ' de ' + personas.length + ' personas con descriptor vigente y evaluación registrada.',
      nota: '',
      evidencia: ev
    };
  },
  '7.3': function () {
    // Toma de conciencia: induccion completada por persona activa.
    var personas = leerFilasSeguro_(SHEETS.SGC_PERSONAS).filter(function (p) {
      return esVerdaderoSgc_(p.activa) && p.estado !== 'DESVINCULADO';
    });
    if (!personas.length) return { estado: 'FALTANTE', resumen: 'No hay personal cargado.', nota: '', evidencia: [] };
    var inducciones = leerFilasSeguro_(SHEETS.SGC_INDUCCIONES);
    var conInduccionCompleta = personas.filter(function (p) {
      var suyas = inducciones.filter(function (i) { return i.persona_id === p.persona_id; });
      return suyas.length > 0 && suyas.every(function (i) { return i.estado === 'COMPLETADO'; });
    });
    var pct = conInduccionCompleta.length / personas.length;
    var ev = conInduccionCompleta.slice(0, 15).map(function (p) {
      return { tipo: 'Inducción completa', descripcion: p.nombre, fecha: '', responsable: '' };
    });
    return {
      estado: pct >= UMBRAL_COBERTURA_COMPLETO ? 'COMPLETO' : (conInduccionCompleta.length ? 'PARCIAL' : 'FALTANTE'),
      resumen: conInduccionCompleta.length + ' de ' + personas.length + ' personas con inducción completa.',
      nota: '',
      evidencia: ev
    };
  },
  '8.4': function () {
    // Proveedores externos: listado + evaluacion vigente.
    var proveedores = leerFilasSeguro_(SHEETS.SGC_PROVEEDORES).filter(function (p) { return esVerdaderoSgc_(p.activa); });
    if (!proveedores.length) return { estado: 'FALTANTE', resumen: 'No hay proveedores cargados.', nota: '', evidencia: [] };
    var evaluados = proveedores.filter(function (p) { return p.estado !== 'SIN_EVALUAR'; });
    var ev = evaluados.slice(0, 15).map(function (p) {
      return { tipo: 'Proveedor evaluado', descripcion: p.nombre + ' — ' + p.estado, fecha: p.ultima_evaluacion_fecha, responsable: '' };
    });
    return {
      estado: evaluados.length === proveedores.length ? 'COMPLETO' : (evaluados.length ? 'PARCIAL' : 'FALTANTE'),
      resumen: evaluados.length + ' de ' + proveedores.length + ' proveedores con evaluación registrada.',
      nota: '',
      evidencia: ev
    };
  },
  '8.7': function () {
    // Salidas no conformes: se solapa con 10.2, pero la norma la cita
    // aparte -- mismas NC como evidencia de que las no conformidades se
    // detectan y controlan, no solo se corrigen.
    return evaluarNoConformidades_();
  },
  '9.1': function () {
    // Seguimiento y medicion: objetivos + auditorias, la misma fuente que
    // usa el auditor para saber si la organizacion se esta mirando a si
    // misma.
    var objetivos6 = EVALUADORES_CLAUSULA_ISO['6.2']();
    return {
      estado: objetivos6.estado,
      resumen: objetivos6.resumen,
      nota: 'Se comparte evidencia con 6.2 (objetivos de calidad).',
      evidencia: objetivos6.evidencia
    };
  },
  '9.2': function () {
    var auditorias = leerFilasSeguro_(SHEETS.SGC_AUDITORIAS).filter(function (a) { return esVerdaderoSgc_(a.activa); });
    if (!auditorias.length) return { estado: 'FALTANTE', resumen: 'No hay auditorías programadas.', nota: '', evidencia: [] };
    var ejecutadas = auditorias.filter(function (a) { return !!a.fecha_ejecucion; });
    var ev = ejecutadas.slice(0, 10).map(function (a) {
      return { tipo: 'Auditoría interna', descripcion: 'Auditoría ' + a.anio, fecha: a.fecha_ejecucion, responsable: a.auditor_email };
    });
    return {
      estado: ejecutadas.length ? 'COMPLETO' : 'PARCIAL',
      resumen: ejecutadas.length + ' de ' + auditorias.length + ' auditorías programadas ya ejecutadas.',
      nota: '',
      evidencia: ev
    };
  },
  '9.3': function () {
    var revisiones = leerFilasSeguro_(SHEETS.SGC_REVISIONES).filter(function (r) { return esVerdaderoSgc_(r.activa); });
    if (!revisiones.length) return { estado: 'FALTANTE', resumen: 'No hay revisiones por la dirección registradas.', nota: '', evidencia: [] };
    var cerradas = revisiones.filter(function (r) { return r.estado === 'CERRADA'; });
    var ev = cerradas.slice(0, 10).map(function (r) {
      return { tipo: 'Revisión por la dirección', descripcion: r.correlativo, fecha: r.fecha_cierre, responsable: r.responsable_calidad_email };
    });
    return {
      estado: cerradas.length ? 'COMPLETO' : 'PARCIAL',
      resumen: cerradas.length + ' de ' + revisiones.length + ' revisiones cerradas.',
      nota: '',
      evidencia: ev
    };
  },
  '10.1': function () { return evaluarNoConformidades_(); },
  '10.2': function () { return evaluarNoConformidades_(); },
  '10.3': function () {
    // Mejora continua: acuerdos de revision por la direccion cumplidos
    // (=Actividad TERMINADA) es la evidencia de que la mejora no se queda
    // en el acta.
    var acuerdos = leerFilasSeguro_(SHEETS.SGC_REVISION_ACUERDOS).filter(function (a) { return esVerdaderoSgc_(a.activa); });
    if (!acuerdos.length) return { estado: 'FALTANTE', resumen: 'No hay acuerdos de mejora registrados.', nota: '', evidencia: [] };
    var actividades = leerFilasSeguro_(SHEETS.ACTIVIDADES);
    var cumplidos = acuerdos.filter(function (a) {
      var act = actividades.filter(function (x) { return x.actividad_id === a.actividad_id; })[0];
      return act && act.estado === 'TERMINADA';
    });
    var ev = acuerdos.slice(0, 10).map(function (a) {
      return { tipo: 'Acuerdo de mejora', descripcion: a.observaciones, fecha: a.plazo, responsable: a.responsable_email };
    });
    return {
      estado: cumplidos.length === acuerdos.length ? 'COMPLETO' : (cumplidos.length ? 'PARCIAL' : 'FALTANTE'),
      resumen: cumplidos.length + ' de ' + acuerdos.length + ' acuerdos de mejora cumplidos.',
      nota: '',
      evidencia: ev
    };
  }
};

function evaluarNoConformidades_() {
  var ncs = leerFilasSeguro_(SHEETS.SGC_NC).filter(function (n) { return esVerdaderoSgc_(n.activa); });
  if (!ncs.length) return { estado: 'FALTANTE', resumen: 'No hay no conformidades registradas.', nota: 'Sin NC no hay evidencia de que el ciclo de mejora esté operando.', evidencia: [] };
  var eficaces = ncs.filter(function (n) { return n.eficacia_resultado === 'EFICAZ'; });
  var ev = ncs.slice(0, 15).map(function (n) {
    return { tipo: 'No conformidad', descripcion: n.descripcion || n.nc_id, fecha: n.fecha_deteccion, responsable: n.responsable_email };
  });
  return {
    estado: eficaces.length ? 'COMPLETO' : 'PARCIAL',
    resumen: ncs.length + ' no conformidades registradas, ' + eficaces.length + ' con eficacia verificada.',
    nota: '',
    evidencia: ev
  };
}

// Clausulas cuya evidencia son documentos ETIQUETADOS por el Encargado SGC
// (SGC_DOCUMENTOS.clausulas_iso) -- SIGSO no adivina cual documento es la
// politica o el mapa de procesos.
// v11.0 Fase 1 (§4.3). Antes esta clausula se media SOLO por documentos
// etiquetados a mano: el sistema no sabia cual era el alcance ni que se
// habia excluido, y esas son dos de las primeras preguntas de una auditoria
// de certificacion. Ahora la fuente principal es la declaracion registrada,
// y el documento que la sustenta suma como respaldo.
//
// La norma pide tres cosas en 4.3 y las tres se revisan por separado, para
// que la nota diga cual falta y no un generico "incompleto".
function evaluarAlcanceDeclarado_() {
  var vigente = (typeof alcanceVigente_ === 'function') ? alcanceVigente_() : null;
  var porDocs = evaluarPorDocumentos_('4.3');

  if (!vigente) {
    return {
      estado: porDocs.evidencia.length ? 'PARCIAL' : 'FALTANTE',
      resumen: 'El alcance del SGC no está declarado en el sistema.',
      nota: 'Declara el alcance en la sección Alcance: qué servicios cubre, en qué ubicaciones y qué cláusulas se excluyen con su justificación. ' +
        (porDocs.evidencia.length ? 'Hay documentos etiquetados para 4.3, pero un documento adjunto no responde por sí solo qué se excluyó.' : ''),
      evidencia: porDocs.evidencia
    };
  }

  var exclusiones = exclusionesDe_(vigente.alcance_id);
  var ev = [{
    tipo: 'Alcance declarado',
    descripcion: 'v' + vigente.version + ' — ' + String(vigente.declaracion || '').slice(0, 160),
    fecha: vigente.vigente_desde || vigente.fecha_creacion,
    responsable: vigente.creado_por
  }];
  exclusiones.forEach(function (e) {
    ev.push({
      tipo: 'Exclusión declarada',
      descripcion: e.clausula + (e.titulo ? ' — ' + e.titulo : '') + ': ' + e.justificacion,
      fecha: e.fecha_creacion,
      responsable: e.creado_por
    });
  });
  porDocs.evidencia.forEach(function (e) { ev.push(e); });

  var falta = [];
  if (!listaDesdeJson_(vigente.areas).length) falta.push('no hay áreas declaradas');
  if (!String(vigente.declaracion || '').trim()) falta.push('falta la declaración de alcance');
  // Una exclusion sin justificacion no es una exclusion valida para §4.3.
  var sinJustificar = exclusiones.filter(function (e) { return !String(e.justificacion || '').trim(); });
  if (sinJustificar.length) falta.push(sinJustificar.length + ' exclusión(es) sin justificación');
  if (!porDocs.evidencia.length) falta.push('ningún documento etiquetado como respaldo de 4.3');

  return {
    estado: falta.length ? 'PARCIAL' : 'COMPLETO',
    resumen: 'Alcance v' + vigente.version + ' declarado, con ' + exclusiones.length + ' exclusión(es).',
    nota: falta.length ? 'Para cerrar 4.3: ' + falta.join('; ') + '.' : '',
    evidencia: ev
  };
}

// v11.0 Fase 2 (§4.1). El contexto se mide por dos cosas distintas, y por
// eso no basta con contar factores: la norma pide DETERMINAR las cuestiones
// internas y externas, y ademas hacerles SEGUIMIENTO Y REVISION. Un FODA
// completo pero sin revisar en dos años no cumple §4.1, y contarlo como
// completo le mentiria al Encargado justo en la pantalla que usa para
// prepararse la auditoria.
function evaluarContextoOrganizacion_() {
  var factores = (typeof factoresContextoActivos_ === 'function') ? factoresContextoActivos_() : [];
  var partes = (typeof partesInteresadasActivas_ === 'function') ? partesInteresadasActivas_() : [];
  var porDocs = evaluarPorDocumentos_('4.1');

  if (!factores.length) {
    return {
      estado: porDocs.evidencia.length ? 'PARCIAL' : 'FALTANTE',
      resumen: 'El análisis de contexto no está cargado en el sistema.',
      nota: 'Carga el análisis FODA en la sección Contexto. ' +
        (porDocs.evidencia.length
          ? 'Hay documentos etiquetados para 4.1, pero un archivo adjunto no permite demostrar el seguimiento periódico que pide la cláusula.'
          : ''),
      evidencia: porDocs.evidencia
    };
  }

  var resumen = resumenContexto_(factores, partes);
  var ev = factores.slice(0, 12).map(function (f) {
    return {
      tipo: 'Factor de contexto (' + f.tipo + ')',
      descripcion: String(f.tipo || '').slice(0, 1) + f.numero + ' — ' + f.descripcion,
      fecha: f.fecha_ultima_revision || f.fecha_identificacion,
      responsable: f.revisado_por || f.creado_por
    };
  });
  porDocs.evidencia.forEach(function (e) { ev.push(e); });

  var falta = [];
  // Los cuatro cuadrantes: un FODA al que le falta un cuadrante entero no es
  // un analisis de contexto completo.
  ['FORTALEZA', 'OPORTUNIDAD', 'DEBILIDAD', 'AMENAZA'].forEach(function (t) {
    if (!resumen.por_tipo[t]) falta.push('no hay ningún factor del tipo ' + t.toLowerCase());
  });
  if (resumen.revision_vencida) {
    falta.push('la última revisión tiene ' + resumen.meses_desde_revision +
      ' meses y la frecuencia definida es de ' + MESES_REVISION_CONTEXTO);
  }

  return {
    estado: falta.length ? 'PARCIAL' : 'COMPLETO',
    resumen: resumen.total_factores + ' factores de contexto identificados' +
      (resumen.ultima_revision ? ', revisados al ' + resumen.ultima_revision : '') + '.',
    nota: falta.length ? 'Para cerrar 4.1: ' + falta.join('; ') + '.' : '',
    evidencia: ev
  };
}

// v11.0 Fase 2 (§4.2). Misma logica: determinar las partes y sus requisitos,
// y hacerles seguimiento. Se revisa ademas que cada parte tenga sus
// necesidades escritas -- una fila con nombre y nada mas no es haber
// determinado sus requisitos.
function evaluarPartesInteresadas_() {
  var partes = (typeof partesInteresadasActivas_ === 'function') ? partesInteresadasActivas_() : [];
  var factores = (typeof factoresContextoActivos_ === 'function') ? factoresContextoActivos_() : [];
  var porDocs = evaluarPorDocumentos_('4.2');

  if (!partes.length) {
    return {
      estado: porDocs.evidencia.length ? 'PARCIAL' : 'FALTANTE',
      resumen: 'Las partes interesadas no están cargadas en el sistema.',
      nota: 'Carga la matriz de partes interesadas en la sección Contexto.',
      evidencia: porDocs.evidencia
    };
  }

  var ev = partes.map(function (p) {
    return {
      tipo: 'Parte interesada',
      descripcion: p.nombre + ' — impacto ' + (p.impacto || '—') + ', influencia ' + (p.influencia || '—'),
      fecha: p.fecha_ultima_revision || p.fecha_creacion,
      responsable: p.responsable_email || p.revisado_por || p.creado_por
    };
  });
  porDocs.evidencia.forEach(function (e) { ev.push(e); });

  var sinRequisitos = partes.filter(function (p) { return !String(p.necesidades || '').trim(); });
  var resumen = resumenContexto_(factores, partes);

  var falta = [];
  if (sinRequisitos.length) {
    falta.push(sinRequisitos.length + ' parte(s) sin necesidades o requisitos determinados');
  }
  if (resumen.revision_vencida) {
    falta.push('la última revisión tiene ' + resumen.meses_desde_revision +
      ' meses y la frecuencia definida es de ' + MESES_REVISION_CONTEXTO);
  }

  return {
    estado: falta.length ? 'PARCIAL' : 'COMPLETO',
    resumen: partes.length + ' partes interesadas determinadas, con sus necesidades y expectativas.',
    nota: falta.length ? 'Para cerrar 4.2: ' + falta.join('; ') + '.' : '',
    evidencia: ev
  };
}

// v11.0 Fase 3 (§6.1). La clausula no pide tener una matriz: pide
// DETERMINAR los riesgos y oportunidades, PLANIFICAR acciones para
// abordarlos e integrarlas en los procesos del sistema. Por eso no basta
// con contar filas.
//
// Se revisan cuatro cosas, y la nota dice cual falta:
//   · que haya riesgos Y oportunidades (§6.1.1 nombra las dos);
//   · que los altos y criticos tengan revaloracion -- una accion escrita sin
//     revalorar no demuestra que el riesgo se haya abordado;
//   · que las acciones esten asignadas a alguien como actividad, que es lo
//     que la norma llama "integrar e implementar" (§6.1.2 b);
//   · que la matriz se haya revisado dentro de la frecuencia definida.
function evaluarRiesgosOportunidades_() {
  var filas = (typeof riesgosActivos_ === 'function') ? riesgosActivos_() : [];
  var porDocs = evaluarPorDocumentos_('6.1');

  if (!filas.length) {
    return {
      estado: porDocs.evidencia.length ? 'PARCIAL' : 'FALTANTE',
      resumen: 'La matriz de riesgos y oportunidades no está cargada en el sistema.',
      nota: 'Carga la matriz en la sección Riesgos. ' +
        (porDocs.evidencia.length
          ? 'Hay documentos etiquetados para 6.1, pero un archivo adjunto no demuestra que las acciones se hayan asignado ni revalorado.'
          : ''),
      evidencia: porDocs.evidencia
    };
  }

  var lista = filas.map(function (r) { return formatearRiesgo_(r, '', null); });
  var resumen = resumenRiesgos_(lista);

  var ev = lista.slice(0, 15).map(function (r) {
    var val = r.inherente ? r.inherente.banda + ' (' + r.inherente.magnitud + ')' : 'sin valorar';
    return {
      tipo: r.clase === 'OPORTUNIDAD' ? 'Oportunidad' : 'Riesgo',
      descripcion: r.codigo + ' — ' + r.factor + ': ' + val +
        (r.residual ? ' → ' + r.residual.banda + ' (' + r.residual.magnitud + ')' : ''),
      fecha: r.fecha_ultima_revision || r.fecha_identificacion,
      responsable: r.responsable_email || r.revisado_por
    };
  });
  porDocs.evidencia.forEach(function (e) { ev.push(e); });

  var falta = [];
  if (!resumen.total_riesgos) falta.push('no hay riesgos identificados');
  if (!resumen.total_oportunidades) falta.push('no hay oportunidades identificadas');
  if (resumen.sin_tratar) {
    falta.push(resumen.sin_tratar + ' riesgo(s) alto o crítico sin revaloración tras los controles');
  }
  if (resumen.sin_accion) {
    falta.push(resumen.sin_accion + ' riesgo(s) sin acción definida');
  }
  if (!resumen.con_actividad) {
    falta.push('ninguna acción está asignada como actividad a un responsable');
  }
  if (resumen.revision_vencida) {
    falta.push('la última revisión tiene ' + resumen.meses_desde_revision +
      ' meses y la frecuencia definida es de ' + MESES_REVISION_RIESGOS);
  }

  return {
    estado: falta.length ? 'PARCIAL' : 'COMPLETO',
    resumen: resumen.total_riesgos + ' riesgos y ' + resumen.total_oportunidades +
      ' oportunidades determinados; ' + resumen.con_actividad + ' con acción asignada.',
    nota: falta.length ? 'Para cerrar 6.1: ' + falta.join('; ') + '.' : '',
    evidencia: ev
  };
}

// v11.0 Fase 4 (§4.4). Antes esta clausula se media solo por documentos
// etiquetados a mano. Ahora la fuente principal es el mapa registrado, y el
// documento que lo sustenta suma como respaldo.
//
// §4.4.1 pide cuatro cosas concretas y se revisan por separado: que los
// procesos esten determinados, que se sepan sus entradas y salidas, que cada
// uno tenga un responsable con autoridad definida (§4.4.2 e), y que el
// conjunto se mantenga al dia.
function evaluarProcesosSgc_() {
  var filas = (typeof procesosActivos_ === 'function') ? procesosActivos_() : [];
  var porDocs = evaluarPorDocumentos_('4.4');

  if (!filas.length) {
    return {
      estado: porDocs.evidencia.length ? 'PARCIAL' : 'FALTANTE',
      resumen: 'El mapa de procesos no está cargado en el sistema.',
      nota: 'Carga el mapa en la sección Procesos. ' +
        (porDocs.evidencia.length
          ? 'Hay documentos etiquetados para 4.4, pero un diagrama adjunto no permite decir quién responde por cada proceso ni si sigue vigente.'
          : ''),
      evidencia: porDocs.evidencia
    };
  }

  var pasos = (typeof pasosActivos_ === 'function') ? pasosActivos_() : [];
  var lista = filas.map(function (p) { return formatearProceso_(p, 0, 0); });
  var resumen = resumenProcesos_(lista, pasos);

  var ev = lista.filter(function (p) { return p.nivel === 'MAPA'; }).map(function (p) {
    return {
      tipo: 'Proceso ' + (p.tipo_etiqueta || '').toLowerCase(),
      descripcion: p.codigo + ' — ' + p.nombre +
        (p.responsable_email ? '' : ' (sin responsable)'),
      fecha: p.fecha_ultima_revision,
      responsable: p.responsable_email || p.revisado_por
    };
  });
  porDocs.evidencia.forEach(function (e) { ev.push(e); });

  var falta = [];
  ['ESTRATEGICO', 'OPERATIVO', 'APOYO'].forEach(function (t) {
    if (!resumen.por_tipo[t]) {
      falta.push('no hay procesos del tipo ' + (ETIQUETA_TIPO_PROCESO[t] || t).toLowerCase());
    }
  });
  if (resumen.sin_responsable) {
    falta.push(resumen.sin_responsable + ' proceso(s) del mapa sin responsable asignado');
  }
  if (resumen.sin_objetivo) {
    falta.push(resumen.sin_objetivo + ' proceso(s) del mapa sin objetivo definido');
  }
  if (resumen.revision_vencida) {
    falta.push('la última revisión tiene ' + resumen.meses_desde_revision +
      ' meses y la frecuencia definida es de ' + MESES_REVISION_PROCESOS);
  }

  return {
    estado: falta.length ? 'PARCIAL' : 'COMPLETO',
    resumen: resumen.total_mapa + ' procesos en el mapa' +
      (resumen.total_servicios ? ', ' + resumen.total_servicios + ' procesos de servicio con ' +
        resumen.total_pasos + ' pasos' : '') + '.',
    nota: falta.length ? 'Para cerrar 4.4: ' + falta.join('; ') + '.' : '',
    evidencia: ev
  };
}

/**
 * v11.0 Fase 4. Las clausulas de operacion (§8.1, §8.5, §8.6) se apoyan en
 * los procesos de SERVICIO: son los que el DOC-01 cita para planificar,
 * prestar y liberar el servicio.
 *
 * Con la definicion cargada quedan en PARCIAL, no en COMPLETO: tener escrito
 * como se presta un servicio no demuestra que se haya prestado. Eso es la
 * evidencia de ejecucion, que llega con la Fase 8. Decirlo explicito evita
 * que alguien lea "completo" y crea que la clausula esta resuelta.
 */
function evaluarOperacionPorProcesos_(codigo, queFalta) {
  var servicios = (typeof procesosActivos_ === 'function')
    ? procesosActivos_().filter(function (p) { return p.nivel === 'SERVICIO'; })
    : [];
  var porDocs = evaluarPorDocumentos_(codigo);

  if (!servicios.length) {
    return {
      estado: porDocs.evidencia.length ? 'PARCIAL' : 'FALTANTE',
      resumen: 'Los procesos de servicio no están cargados en el sistema.',
      nota: NOTA_FALTANTE_POR_DEFECTO_ISO[codigo] ||
        'Carga los procesos de servicio (DOC-10 a DOC-13) en la sección Procesos.',
      evidencia: porDocs.evidencia
    };
  }

  var pasos = (typeof pasosActivos_ === 'function') ? pasosActivos_() : [];
  var conPasos = {};
  pasos.forEach(function (p) { conPasos[p.proceso_id] = true; });
  var sinPasos = servicios.filter(function (p) { return !conPasos[p.proceso_id]; });

  var ev = servicios.slice(0, 15).map(function (p) {
    return {
      tipo: 'Proceso de servicio',
      descripcion: p.codigo + ' — ' + p.nombre + (p.area ? ' (' + p.area + ')' : ''),
      fecha: p.fecha_ultima_revision,
      responsable: p.responsable_email || p.revisado_por
    };
  });
  porDocs.evidencia.forEach(function (e) { ev.push(e); });

  var nota = queFalta;
  if (sinPasos.length) {
    nota = sinPasos.length + ' proceso(s) de servicio sin pasos definidos. ' + nota;
  }

  return {
    estado: 'PARCIAL',
    resumen: servicios.length + ' procesos de servicio definidos, con ' + pasos.length + ' pasos.',
    nota: nota,
    evidencia: ev
  };
}

function evaluarPorDocumentos_(codigo) {
  var docs = leerFilasSeguro_(SHEETS.SGC_DOCUMENTOS).filter(function (d) {
    return esVerdaderoSgc_(d.activa) && d.estado === 'VIGENTE' &&
      parsearClausulasIsoSgc_(d.clausulas_iso).indexOf(codigo) !== -1;
  });
  var ev = docs.map(function (d) {
    return { tipo: 'Documento vigente', descripcion: d.codigo + ' — ' + d.nombre, fecha: d.fecha_vigencia, responsable: d.aprobado_por };
  });
  return {
    estado: docs.length ? 'COMPLETO' : 'FALTANTE',
    resumen: docs.length ? docs.length + ' documento(s) etiquetado(s) para esta cláusula.' : 'Sin documentos etiquetados para esta cláusula.',
    nota: docs.length ? '' : 'Etiqueta el documento correspondiente (por ejemplo, la política de calidad) en su ficha, sección "Cláusulas ISO".',
    evidencia: ev
  };
}

// Evaluador por defecto para clausulas sin fuente de datos en SIGSO hoy
// (contexto, riesgos, planificacion de recursos, diseño, evidencia de
// servicios...). Se declara explicito por que, en vez de mostrar un vacio
// sin explicacion.
var NOTA_FALTANTE_POR_DEFECTO_ISO = {
  '6.3': 'La planificación de cambios no tiene un módulo propio en SIGSO hoy.',
  '7.1': 'La planificación de recursos no tiene un módulo propio en SIGSO hoy.',
  '8.1': 'Requiere la evidencia de servicios (matriz cliente × proceso × período), pendiente para la Fase 7.',
  '8.2': 'Los requisitos de productos y servicios no tienen un módulo propio en SIGSO hoy.',
  // La nota anterior sugeria que 8.3 "puede no aplicar". Decidir eso por
  // insinuacion es justo lo que §4.3 prohibe: mientras no exista una
  // exclusion declarada CON justificacion, la norma considera la clausula
  // aplicable. La nota ahora apunta al lugar donde esa decision se toma.
  '8.3': 'Sin evidencia estructurada. Si la organización determinó que esta cláusula no le aplica, tiene que declararlo como exclusión en Alcance, con su justificación (§4.3): mientras no esté declarada, la cláusula se considera aplicable.',
  '8.5': 'Requiere la evidencia de servicios (matriz cliente × proceso × período), pendiente para la Fase 7.',
  '8.6': 'La liberación de productos y servicios no tiene un módulo propio en SIGSO hoy.'
};

function evaluarClausula_(codigo, excluidas) {
  var exclusiones = (excluidas || exclusionesVigentesPorClausula_())[codigo] || [];

  // Una exclusion de la clausula COMPLETA la saca de la evaluacion. Una de
  // sub-clausula (7.1.5.2 dentro de 7.1) NO: el resto de la clausula sigue
  // aplicando, solo se anota para que el auditor lo vea junto a la evidencia.
  var total = exclusiones.filter(function (e) { return e.total; })[0];
  if (total) {
    return {
      estado: 'NO_APLICA',
      resumen: 'Excluida del alcance del SGC.',
      nota: 'Exclusión declarada en el alcance (§4.3): ' + (total.justificacion || 'sin justificación registrada.'),
      evidencia: []
    };
  }

  var evaluador = EVALUADORES_CLAUSULA_ISO[codigo];
  var r = evaluador ? evaluador() : {
    estado: 'FALTANTE',
    resumen: 'Sin evidencia estructurada en el sistema.',
    nota: NOTA_FALTANTE_POR_DEFECTO_ISO[codigo] || 'Sin evidencia estructurada en el sistema todavía.',
    evidencia: []
  };

  if (exclusiones.length) {
    var listado = exclusiones.map(function (e) { return e.clausula; }).join(', ');
    r.nota = (r.nota ? r.nota + ' ' : '') +
      'Con exclusión parcial declarada en el alcance (' + listado + '): el resto de la cláusula sí aplica.';
  }
  return r;
}

// La edicion de norma que declara el alcance vigente. Si todavia no hay
// alcance declarado se responde la del sistema, para que la matriz nunca
// quede sin decir contra que norma esta midiendo.
function normaDeclarada_() {
  var vigente = (typeof alcanceVigente_ === 'function') ? alcanceVigente_() : null;
  if (vigente && vigente.norma_codigo) {
    return { codigo: vigente.norma_codigo, version: vigente.norma_version, declarada: true };
  }
  return {
    codigo: NORMA_SGC_POR_DEFECTO.codigo,
    version: NORMA_SGC_POR_DEFECTO.version,
    declarada: false
  };
}

// --- PDF del modo auditoria ---------------------------------------------------

var ETIQUETA_ESTADO_COBERTURA = { COMPLETO: 'Completo', PARCIAL: 'Parcial', FALTANTE: 'Faltante', NO_APLICA: 'No aplica' };
var COLOR_ESTADO_COBERTURA = { COMPLETO: '#166534', PARCIAL: '#92400E', FALTANTE: '#991B1B', NO_APLICA: '#475569' };

function construirHtmlEvidenciaClausula_(clausula, r) {
  var filas = r.evidencia.map(function (e) {
    return '<tr>' +
      '<td style="padding:6px 8px;border-bottom:1px solid #E5E7EB;">' + escaparHtmlPdf_(e.tipo) + '</td>' +
      '<td style="padding:6px 8px;border-bottom:1px solid #E5E7EB;">' + escaparHtmlPdf_(e.descripcion || '') + '</td>' +
      '<td style="padding:6px 8px;border-bottom:1px solid #E5E7EB;white-space:nowrap;">' + (e.fecha ? String(e.fecha).slice(0, 10) : '—') + '</td>' +
      '<td style="padding:6px 8px;border-bottom:1px solid #E5E7EB;">' + escaparHtmlPdf_(e.responsable || '—') + '</td>' +
      '</tr>';
  }).join('');

  var color = COLOR_ESTADO_COBERTURA[r.estado] || '#374151';
  return '<html><body style="font-family:Arial,Helvetica,sans-serif;color:#1F2937;padding:24px;">' +
    '<h1 style="font-size:18px;margin:0 0 4px;">SIGSO — Evidencia de auditoría</h1>' +
    '<p style="color:#6B7280;margin:0 0 20px;">Generado el ' + new Date().toISOString().slice(0, 10) + '</p>' +
    '<h2 style="font-size:16px;margin:0 0 4px;">Cláusula ' + escaparHtmlPdf_(clausula.codigo) + ' — ' + escaparHtmlPdf_(clausula.titulo) + '</h2>' +
    '<p style="margin:0 0 4px;"><strong>Estado:</strong> <span style="color:' + color + ';">' + (ETIQUETA_ESTADO_COBERTURA[r.estado] || r.estado) + '</span></p>' +
    '<p style="margin:0 0 16px;color:#374151;">' + escaparHtmlPdf_(r.resumen) + '</p>' +
    (r.nota ? '<p style="margin:0 0 16px;color:#92400E;">' + escaparHtmlPdf_(r.nota) + '</p>' : '') +
    (filas
      ? '<table style="width:100%;border-collapse:collapse;font-size:12px;">' +
        '<thead><tr style="text-align:left;color:#6B7280;">' +
          '<th style="padding:6px 8px;border-bottom:2px solid #1F2937;">Tipo</th>' +
          '<th style="padding:6px 8px;border-bottom:2px solid #1F2937;">Descripción</th>' +
          '<th style="padding:6px 8px;border-bottom:2px solid #1F2937;">Fecha</th>' +
          '<th style="padding:6px 8px;border-bottom:2px solid #1F2937;">Responsable</th>' +
        '</tr></thead><tbody>' + filas + '</tbody></table>'
      : '<p style="color:#9AA1AC;">Sin registros de evidencia para esta cláusula.</p>') +
    '</body></html>';
}

function escaparHtmlPdf_(texto) {
  return String(texto == null ? '' : texto)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}
