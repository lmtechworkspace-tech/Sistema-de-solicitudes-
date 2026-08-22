/**
 * Contexto.gs — v11.0 Fase 2: contexto de la organizacion (§4.1) y partes
 * interesadas (§4.2).
 *
 * Son las dos primeras clausulas de la norma y las dos estaban sin evaluador
 * en la matriz de cobertura: no habia donde vivieran. La empresa las tiene
 * resueltas en papel (DOC-02 "Analisis FODA" y DOC-04 "Matriz de partes
 * interesadas v02"), asi que esto NO redacta nada nuevo -- estructura lo que
 * ya esta aprobado.
 *
 * Por que estructurarlo en vez de dejarlo como archivo adjunto, que es el
 * criterio general del modulo:
 *
 * 1. §4.1 y §4.2 no piden LISTAR, piden hacer **seguimiento y revision**. Un
 *    Word no sabe decir "esto lleva catorce meses sin revisarse", y esa es
 *    justo la pregunta del auditor.
 *
 * 2. Siete de los once riesgos del DOC-08 son literalmente debilidades y
 *    amenazas del FODA. Con los factores como registros, la Fase 3 puede
 *    enlazar riesgo -> factor y la cadena queda visible. Hoy solo existe en
 *    la cabeza de quien redacto ambos documentos.
 *
 * Igual que en la Fase 1: **nada se siembra solo**. El contenido de ambos
 * documentos viaja como PROPUESTA, se muestra para revisar, y se guarda
 * recien cuando una persona lo confirma.
 *
 * El documento original se sigue subiendo al repositorio y se etiqueta con
 * su clausula: el archivo aprobado y firmado es la evidencia, esto es la
 * herramienta de seguimiento.
 */

// §4.1 y §4.2 se revisan en la revision por la direccion, con frecuencia
// anual: lo dice el DOC-01 ("revisado en cada revision de la direccion, con
// una frecuencia anual") y lo repite el DOC-04 ("se monitorea y revisa
// anualmente"). De ahi salen los 12 meses, no de un criterio propio.
var MESES_REVISION_CONTEXTO = 12;

var TIPOS_FACTOR_CONTEXTO = ['FORTALEZA', 'OPORTUNIDAD', 'DEBILIDAD', 'AMENAZA'];

// El origen se deriva del tipo: fortalezas y debilidades son internas,
// oportunidades y amenazas externas. Es la definicion del analisis FODA, no
// una decision de este modulo.
var ORIGEN_POR_TIPO_CONTEXTO = {
  FORTALEZA: 'INTERNO', DEBILIDAD: 'INTERNO',
  OPORTUNIDAD: 'EXTERNO', AMENAZA: 'EXTERNO'
};

var NIVELES_PARTE_INTERESADA = ['Alto', 'Medio', 'Bajo'];

// Los 24 factores del DOC-02, transcritos. El numero es el que trae el
// documento dentro de su cuadrante, para poder citar "D3" y que se entienda.
var FODA_PROPUESTO_DOC02 = [
  { tipo: 'FORTALEZA', numero: 1, descripcion: 'Servicio integral ("todo en uno") para el contratista: gestión administrativa, RRHH, contabilidad, prevención de riesgos y marketing corporativo.' },
  { tipo: 'FORTALEZA', numero: 2, descripcion: 'Personal con experiencia en los rubros atendidos.' },
  { tipo: 'FORTALEZA', numero: 3, descripcion: 'Cobertura completa de servicios requeridos por el cliente en un solo proveedor.' },
  { tipo: 'FORTALEZA', numero: 4, descripcion: 'Pronta respuesta frente a requerimientos de corto plazo.' },
  { tipo: 'FORTALEZA', numero: 5, descripcion: 'Implementación de procesos con estándar ISO 9001 (en desarrollo).' },
  { tipo: 'FORTALEZA', numero: 6, descripcion: 'Compromiso del equipo con la mejora continua.' },
  { tipo: 'FORTALEZA', numero: 7, descripcion: 'Migración a plataforma HomePymes Digital: optimiza tiempos y reduce dependencia de envíos físicos.' },

  { tipo: 'OPORTUNIDAD', numero: 1, descripcion: 'Aumento de la demanda de soluciones integrales por parte de pymes que buscan externalizar servicios administrativos.' },
  { tipo: 'OPORTUNIDAD', numero: 2, descripcion: 'Expansión a otros rubros de pymes y contratistas (agrícola, naviero, retail, etc.).' },
  { tipo: 'OPORTUNIDAD', numero: 3, descripcion: 'Reactivación del sector construcción (mayor demanda potencial).' },
  { tipo: 'OPORTUNIDAD', numero: 4, descripcion: 'Transformación digital acelerada: empresas necesitan migrar sus servicios a sistemas en línea.' },
  { tipo: 'OPORTUNIDAD', numero: 5, descripcion: 'Internacionalización post-certificación con casa certificadora reconocida.' },
  { tipo: 'OPORTUNIDAD', numero: 6, descripcion: 'Aumento de fiscalizaciones de manera online, incrementando el apoyo de HomePymes.' },

  { tipo: 'DEBILIDAD', numero: 1, descripcion: 'No se han establecido, definido e implementado indicadores de gestión (KPI) en todas las áreas.' },
  { tipo: 'DEBILIDAD', numero: 2, descripcion: 'No se han implementado evaluaciones de desempeño en todas las áreas.' },
  { tipo: 'DEBILIDAD', numero: 3, descripcion: 'Falta de contratos formales con clientes (acuerdos actuales son verbales o por correo).' },
  { tipo: 'DEBILIDAD', numero: 4, descripcion: 'No existe plan de fidelización con los clientes.' },
  { tipo: 'DEBILIDAD', numero: 5, descripcion: 'Documentación dispersa en múltiples canales (Drive, correo, intranet), riesgo de extravío.' },
  { tipo: 'DEBILIDAD', numero: 6, descripcion: 'Procesos internos que carecen de estandarización completa, afectando la eficiencia.' },
  { tipo: 'DEBILIDAD', numero: 7, descripcion: 'Cobertura geográfica limitada en Prevención de Riesgos (solo Región Metropolitana).' },

  { tipo: 'AMENAZA', numero: 1, descripcion: 'Alta competencia en el sector de asesorías (empresas nacionales).' },
  { tipo: 'AMENAZA', numero: 2, descripcion: 'Rápida obsolescencia de tecnologías y necesidad de actualización constante.' },
  { tipo: 'AMENAZA', numero: 3, descripcion: 'Normativas más estrictas en ciberseguridad que pueden aumentar costos.' },
  { tipo: 'AMENAZA', numero: 4, descripcion: 'Clientes sin compromiso contractual de permanencia mínima.' }
];

// Las cuatro partes del DOC-04 v02, con las SEIS columnas que el documento
// realmente tiene. Los campos de seguimiento van vacios a proposito.
var PARTES_PROPUESTAS_DOC04 = [
  {
    nombre: 'Clientes (Pymes y Contratistas)',
    categoria: 'Externa',
    necesidades: 'Asesoría integral en gestión administrativa, RRHH, contabilidad, prevención de riesgos y marketing corporativo. Calidad y confiabilidad de la información entregada. Precios competitivos y propuesta de valor integral. Atención personalizada y seguimiento post-servicio.',
    expectativa: 'Asesoría integral gestionada por personal competente y especializado. Respuesta ágil y oportuna ante requerimientos urgentes. Cumplimiento de plazos comprometidos en todos los servicios. Información contable, tributaria y laboral sin errores ni retrasos. Que HomePymes cubra todos los servicios requeridos. Acceso a plataforma digital para consultar el estado de sus servicios. Precios competitivos.',
    efecto_sgc: 'Recibir retroalimentación de clientes según encuesta de satisfacción.',
    impacto: 'Alto',
    influencia: 'Alto'
  },
  {
    nombre: 'Alta Dirección',
    categoria: 'Interna',
    necesidades: 'Resultados financieros y operativos alineados con los objetivos estratégicos. Información de gestión confiable y oportuna para la toma de decisiones. Cumplimiento de requisitos legales, normativos y del SGC ISO 9001. Posicionamiento y reputación de la empresa en el mercado.',
    expectativa: 'Rentabilidad sostenida y crecimiento de la cartera de clientes. Implementación exitosa y certificación ISO 9001 dentro del plazo establecido. Tableros de control y reportes de gestión actualizados por área. Personal comprometido con la mejora continua y los estándares de calidad. Empresa posicionada como referente en asesoría integral para pymes del sector construcción.',
    efecto_sgc: 'Sus decisiones estratégicas y la asignación de recursos son determinantes para la implementación, mantenimiento y mejora continua del SGC ISO 9001.',
    impacto: 'Alto',
    influencia: 'Alto'
  },
  {
    nombre: 'Colaboradores Internos',
    categoria: 'Interna',
    necesidades: 'Claridad en sus funciones, responsabilidades y dependencias jerárquicas. Capacitación y formación continua para el desempeño del cargo. Comunicación interna fluida y canales formales de reporte. Herramientas y plataformas adecuadas para ejecutar su trabajo.',
    expectativa: 'Descriptores de cargo entendibles y actualizados. Plan de capacitaciones anuales (≥5 horas por colaborador/año). Evaluaciones de desempeño formales y retroalimentación periódica. Acceso a procedimientos documentados del SGC para ejecutar sus tareas. Participación activa en el proceso de mejora continua.',
    efecto_sgc: 'Su competencia, compromiso y adherencia a los procedimientos del SGC son fundamentales para la calidad del servicio. Sus no conformidades y propuestas de mejora alimentan el ciclo de mejora continua.',
    impacto: 'Alto',
    influencia: 'Medio'
  },
  {
    nombre: 'Proveedores (Plataformas)',
    categoria: 'Externa',
    necesidades: 'Cumplimiento en el pago oportuno de la mensualidad de las plataformas. Canalización formal de tickets de soporte ante incidencias técnicas.',
    expectativa: 'Alta disponibilidad sin caída de servidores. Resolución rápida y efectiva de incidencias técnicas. Resguardo absoluto y seguridad de la información y bases de datos.',
    efecto_sgc: 'Son críticos para la prestación del servicio: una caída de la plataforma o una brecha de seguridad genera incumplimiento de plazos legales (multas para el cliente). El SGC exige que estos proveedores sean evaluados y monitoreados periódicamente para garantizar la calidad del servicio final.',
    impacto: 'Alto',
    influencia: 'Alto'
  }
];

var Contexto = {

  /**
   * El FODA y las partes interesadas en una sola respuesta: son las dos
   * caras del contexto y la pantalla las muestra juntas. Lectura abierta a
   * cualquiera que entre a Calidad -- conocer el contexto es parte de la
   * toma de conciencia (§7.3), no informacion reservada.
   */
  obtener: function (data, contexto) {
    var rol = rolSgc_(contexto);
    var gobierna = gobiernaSgc_(contexto, rol);

    var factores = factoresContextoActivos_();
    var partes = partesInteresadasActivas_();

    return {
      puede_gestionar: gobierna,
      meses_revision: MESES_REVISION_CONTEXTO,
      tipos_factor: TIPOS_FACTOR_CONTEXTO,
      niveles: NIVELES_PARTE_INTERESADA,
      factores: factores.map(formatearFactorContexto_),
      partes: partes.map(formatearParteInteresada_),
      resumen: resumenContexto_(factores, partes),
      // Igual que el alcance: se OFRECEN, no se guardan.
      propuesta_foda: factores.length ? null : FODA_PROPUESTO_DOC02,
      propuesta_partes: partes.length ? null : PARTES_PROPUESTAS_DOC04
    };
  },

  /**
   * Carga los 24 factores del DOC-02 de una vez. Es una accion explicita del
   * Encargado, no un sembrado automatico: la pantalla se los muestra antes.
   */
  sembrarFoda: function (data, contexto) {
    var rol = rolSgc_(contexto);
    if (!gobiernaSgc_(contexto, rol)) {
      return { _forbidden: true, message: 'Solo el Encargado del SGC puede cargar el análisis de contexto.' };
    }
    if (factoresContextoActivos_().length) {
      return { ok: false, message: 'El análisis de contexto ya está cargado. Agrega o edita factores uno a uno.' };
    }

    var ahora = new Date().toISOString();
    var hoy = ahora.slice(0, 10);
    FODA_PROPUESTO_DOC02.forEach(function (f) {
      agregarFila_(SHEETS.SGC_CONTEXTO, {
        factor_id: Utilities.getUuid(),
        tipo: f.tipo,
        origen: ORIGEN_POR_TIPO_CONTEXTO[f.tipo],
        numero: f.numero,
        descripcion: f.descripcion,
        estado: 'VIGENTE',
        observaciones: '',
        fecha_identificacion: hoy,
        fecha_ultima_revision: hoy,
        revisado_por: (contexto && contexto.email) || '',
        creado_por: (contexto && contexto.email) || '',
        fecha_creacion: ahora,
        activa: true
      });
    });
    registrarLogSgc_('SGC_CONTEXTO_SEMBRADO',
      FODA_PROPUESTO_DOC02.length + ' factores del DOC-02 cargados', contexto);
    return { ok: true, total: FODA_PROPUESTO_DOC02.length, message: 'Análisis de contexto cargado.' };
  },

  guardarFactor: function (data, contexto) {
    var rol = rolSgc_(contexto);
    if (!gobiernaSgc_(contexto, rol)) {
      return { _forbidden: true, message: 'Solo el Encargado del SGC puede editar el análisis de contexto.' };
    }

    var tipo = String((data && data.tipo) || '').trim().toUpperCase();
    if (TIPOS_FACTOR_CONTEXTO.indexOf(tipo) === -1) {
      return { ok: false, message: 'El tipo tiene que ser fortaleza, oportunidad, debilidad o amenaza.' };
    }
    var descripcion = String((data && data.descripcion) || '').trim();
    if (!descripcion) return { ok: false, message: 'Describe el factor.' };

    var ahora = new Date().toISOString();
    var campos = {
      tipo: tipo,
      origen: ORIGEN_POR_TIPO_CONTEXTO[tipo],
      descripcion: descripcion,
      observaciones: String((data && data.observaciones) || '').trim(),
      estado: String((data && data.estado) || 'VIGENTE').trim().toUpperCase() === 'SUPERADO' ? 'SUPERADO' : 'VIGENTE',
      fecha_ultima_revision: ahora.slice(0, 10),
      revisado_por: (contexto && contexto.email) || ''
    };

    if (data.factor_id) {
      var actual = factoresContextoActivos_().filter(function (f) { return f.factor_id === data.factor_id; })[0];
      if (!actual) return { ok: false, message: 'No se encontró el factor.' };
      actualizarFilaPorId_(SHEETS.SGC_CONTEXTO, 'factor_id', actual.factor_id, campos);
      registrarLogSgc_('SGC_CONTEXTO_EDITADO', tipo + ' ' + actual.numero + ' actualizado', contexto);
      return { ok: true, factor_id: actual.factor_id, message: 'Factor actualizado.' };
    }

    campos.factor_id = Utilities.getUuid();
    campos.numero = siguienteNumeroFactor_(tipo);
    campos.fecha_identificacion = ahora.slice(0, 10);
    campos.creado_por = (contexto && contexto.email) || '';
    campos.fecha_creacion = ahora;
    campos.activa = true;
    agregarFila_(SHEETS.SGC_CONTEXTO, campos);
    registrarLogSgc_('SGC_CONTEXTO_AGREGADO', tipo + ' ' + campos.numero + ' agregado', contexto);
    return { ok: true, factor_id: campos.factor_id, message: 'Factor agregado.' };
  },

  anularFactor: function (data, contexto) {
    var rol = rolSgc_(contexto);
    if (!gobiernaSgc_(contexto, rol)) {
      return { _forbidden: true, message: 'Solo el Encargado del SGC puede quitar factores.' };
    }
    var f = factoresContextoActivos_().filter(function (x) { return x.factor_id === data.factor_id; })[0];
    if (!f) return { ok: false, message: 'No se encontró el factor.' };
    actualizarFilaPorId_(SHEETS.SGC_CONTEXTO, 'factor_id', f.factor_id, { activa: false });
    registrarLogSgc_('SGC_CONTEXTO_QUITADO', f.tipo + ' ' + f.numero + ' quitado', contexto);
    return { ok: true, message: 'Factor quitado del análisis.' };
  },

  /**
   * Deja constancia de que el contexto se reviso, aunque no cambie nada.
   * §4.1 pide seguimiento y revision: "lo revisamos y sigue igual" ES la
   * evidencia, y sin este boton la unica forma de registrarla seria
   * modificar un factor sin necesidad.
   */
  registrarRevision: function (data, contexto) {
    var rol = rolSgc_(contexto);
    if (!gobiernaSgc_(contexto, rol)) {
      return { _forbidden: true, message: 'Solo el Encargado del SGC puede registrar la revisión del contexto.' };
    }
    var factores = factoresContextoActivos_();
    var partes = partesInteresadasActivas_();
    if (!factores.length && !partes.length) {
      return { ok: false, message: 'No hay nada que revisar todavía.' };
    }

    var hoy = new Date().toISOString().slice(0, 10);
    var email = (contexto && contexto.email) || '';
    factores.forEach(function (f) {
      actualizarFilaPorId_(SHEETS.SGC_CONTEXTO, 'factor_id', f.factor_id,
        { fecha_ultima_revision: hoy, revisado_por: email });
    });
    partes.forEach(function (p) {
      actualizarFilaPorId_(SHEETS.SGC_PARTES_INTERESADAS, 'parte_id', p.parte_id,
        { fecha_ultima_revision: hoy, revisado_por: email });
    });
    registrarLogSgc_('SGC_CONTEXTO_REVISADO',
      'Revisión de contexto y partes interesadas al ' + hoy, contexto);
    return { ok: true, message: 'Revisión registrada al ' + hoy + '.' };
  },

  sembrarPartes: function (data, contexto) {
    var rol = rolSgc_(contexto);
    if (!gobiernaSgc_(contexto, rol)) {
      return { _forbidden: true, message: 'Solo el Encargado del SGC puede cargar las partes interesadas.' };
    }
    if (partesInteresadasActivas_().length) {
      return { ok: false, message: 'Las partes interesadas ya están cargadas. Agrégalas o edítalas una a una.' };
    }

    var ahora = new Date().toISOString();
    var hoy = ahora.slice(0, 10);
    PARTES_PROPUESTAS_DOC04.forEach(function (p) {
      agregarFila_(SHEETS.SGC_PARTES_INTERESADAS, {
        parte_id: Utilities.getUuid(),
        nombre: p.nombre,
        categoria: p.categoria,
        necesidades: p.necesidades,
        expectativa: p.expectativa,
        efecto_sgc: p.efecto_sgc,
        impacto: p.impacto,
        influencia: p.influencia,
        metodo_seguimiento: '',
        frecuencia_seguimiento: '',
        responsable_email: '',
        estado: 'VIGENTE',
        fecha_ultima_revision: hoy,
        revisado_por: (contexto && contexto.email) || '',
        creado_por: (contexto && contexto.email) || '',
        fecha_creacion: ahora,
        activa: true
      });
    });
    registrarLogSgc_('SGC_PARTES_SEMBRADAS',
      PARTES_PROPUESTAS_DOC04.length + ' partes interesadas del DOC-04 cargadas', contexto);
    return { ok: true, total: PARTES_PROPUESTAS_DOC04.length, message: 'Partes interesadas cargadas.' };
  },

  guardarParte: function (data, contexto) {
    var rol = rolSgc_(contexto);
    if (!gobiernaSgc_(contexto, rol)) {
      return { _forbidden: true, message: 'Solo el Encargado del SGC puede editar las partes interesadas.' };
    }

    var nombre = String((data && data.nombre) || '').trim();
    if (!nombre) return { ok: false, message: 'Indica el nombre de la parte interesada.' };
    var necesidades = String((data && data.necesidades) || '').trim();
    if (!necesidades) {
      return { ok: false, message: 'Indica sus necesidades o requisitos: es lo que §4.2 pide determinar.' };
    }
    var nivel = function (v, campo) {
      var t = String(v || '').trim();
      if (!t) return { error: 'Indica el ' + campo + ' (Alto, Medio o Bajo).' };
      var m = NIVELES_PARTE_INTERESADA.filter(function (n) { return n.toLowerCase() === t.toLowerCase(); })[0];
      return m ? { valor: m } : { error: 'El ' + campo + ' tiene que ser Alto, Medio o Bajo.' };
    };
    var imp = nivel(data.impacto, 'impacto');
    if (imp.error) return { ok: false, message: imp.error };
    var inf = nivel(data.influencia, 'nivel de influencia');
    if (inf.error) return { ok: false, message: inf.error };

    var ahora = new Date().toISOString();
    var campos = {
      nombre: nombre,
      categoria: String((data && data.categoria) || '').trim(),
      necesidades: necesidades,
      expectativa: String((data && data.expectativa) || '').trim(),
      efecto_sgc: String((data && data.efecto_sgc) || '').trim(),
      impacto: imp.valor,
      influencia: inf.valor,
      metodo_seguimiento: String((data && data.metodo_seguimiento) || '').trim(),
      frecuencia_seguimiento: String((data && data.frecuencia_seguimiento) || '').trim(),
      responsable_email: String((data && data.responsable_email) || '').trim(),
      estado: 'VIGENTE',
      fecha_ultima_revision: ahora.slice(0, 10),
      revisado_por: (contexto && contexto.email) || ''
    };

    if (data.parte_id) {
      var actual = partesInteresadasActivas_().filter(function (p) { return p.parte_id === data.parte_id; })[0];
      if (!actual) return { ok: false, message: 'No se encontró la parte interesada.' };
      actualizarFilaPorId_(SHEETS.SGC_PARTES_INTERESADAS, 'parte_id', actual.parte_id, campos);
      registrarLogSgc_('SGC_PARTE_EDITADA', nombre + ' actualizada', contexto);
      return { ok: true, parte_id: actual.parte_id, message: 'Parte interesada actualizada.' };
    }

    campos.parte_id = Utilities.getUuid();
    campos.creado_por = (contexto && contexto.email) || '';
    campos.fecha_creacion = ahora;
    campos.activa = true;
    agregarFila_(SHEETS.SGC_PARTES_INTERESADAS, campos);
    registrarLogSgc_('SGC_PARTE_AGREGADA', nombre + ' agregada', contexto);
    return { ok: true, parte_id: campos.parte_id, message: 'Parte interesada agregada.' };
  },

  anularParte: function (data, contexto) {
    var rol = rolSgc_(contexto);
    if (!gobiernaSgc_(contexto, rol)) {
      return { _forbidden: true, message: 'Solo el Encargado del SGC puede quitar partes interesadas.' };
    }
    var p = partesInteresadasActivas_().filter(function (x) { return x.parte_id === data.parte_id; })[0];
    if (!p) return { ok: false, message: 'No se encontró la parte interesada.' };
    actualizarFilaPorId_(SHEETS.SGC_PARTES_INTERESADAS, 'parte_id', p.parte_id, { activa: false });
    registrarLogSgc_('SGC_PARTE_QUITADA', p.nombre + ' quitada', contexto);
    return { ok: true, message: 'Parte interesada quitada.' };
  }
};

// --- helpers ----------------------------------------------------------------

function factoresContextoActivos_() {
  return leerFilasSeguro_(SHEETS.SGC_CONTEXTO).filter(function (f) {
    return esVerdaderoSgc_(f.activa);
  });
}

function partesInteresadasActivas_() {
  return leerFilasSeguro_(SHEETS.SGC_PARTES_INTERESADAS).filter(function (p) {
    return esVerdaderoSgc_(p.activa);
  });
}

function siguienteNumeroFactor_(tipo) {
  var delTipo = factoresContextoActivos_().filter(function (f) { return f.tipo === tipo; });
  var max = 0;
  delTipo.forEach(function (f) {
    var n = parseInt(f.numero, 10);
    if (isFinite(n) && n > max) max = n;
  });
  return max + 1;
}

/**
 * La fecha de revision mas ANTIGUA de todo el contexto, no la mas reciente.
 * Si alguien reviso una parte interesada ayer pero el FODA lleva dos años
 * sin tocarse, el contexto NO esta al dia -- quedarse con la mas reciente
 * daria por revisado lo que nadie miro.
 */
function fechaRevisionContextoMasAntigua_(factores, partes) {
  var fechas = [];
  factores.forEach(function (f) { if (f.fecha_ultima_revision) fechas.push(String(f.fecha_ultima_revision).slice(0, 10)); });
  partes.forEach(function (p) { if (p.fecha_ultima_revision) fechas.push(String(p.fecha_ultima_revision).slice(0, 10)); });
  if (!fechas.length) return '';
  fechas.sort();
  return fechas[0];
}

function mesesDesde_(claveFecha) {
  if (!claveFecha) return null;
  var partes = String(claveFecha).slice(0, 10).split('-');
  if (partes.length !== 3) return null;
  var desde = Date.UTC(Number(partes[0]), Number(partes[1]) - 1, Number(partes[2]));
  if (!isFinite(desde)) return null;
  var dias = Math.floor((Date.now() - desde) / 86400000);
  return Math.floor(dias / 30.4375);
}

function resumenContexto_(factores, partes) {
  var porTipo = { FORTALEZA: 0, OPORTUNIDAD: 0, DEBILIDAD: 0, AMENAZA: 0 };
  factores.forEach(function (f) {
    if (f.estado === 'SUPERADO') return;
    if (porTipo[f.tipo] === undefined) porTipo[f.tipo] = 0;
    porTipo[f.tipo]++;
  });

  var ultima = fechaRevisionContextoMasAntigua_(factores, partes);
  var meses = mesesDesde_(ultima);

  return {
    total_factores: factores.length,
    superados: factores.filter(function (f) { return f.estado === 'SUPERADO'; }).length,
    por_tipo: porTipo,
    total_partes: partes.length,
    ultima_revision: ultima,
    meses_desde_revision: meses,
    revision_vencida: meses !== null && meses >= MESES_REVISION_CONTEXTO
  };
}

function formatearFactorContexto_(f) {
  return {
    factor_id: f.factor_id,
    tipo: f.tipo,
    origen: f.origen || ORIGEN_POR_TIPO_CONTEXTO[f.tipo] || '',
    numero: f.numero,
    // Etiqueta corta para citarlo desde un riesgo: F3, D7, A2...
    codigo: String(f.tipo || '').slice(0, 1) + f.numero,
    descripcion: f.descripcion,
    estado: f.estado || 'VIGENTE',
    observaciones: f.observaciones || '',
    fecha_identificacion: f.fecha_identificacion || '',
    fecha_ultima_revision: f.fecha_ultima_revision || '',
    revisado_por: f.revisado_por || ''
  };
}

function formatearParteInteresada_(p) {
  return {
    parte_id: p.parte_id,
    nombre: p.nombre,
    categoria: p.categoria || '',
    necesidades: p.necesidades || '',
    expectativa: p.expectativa || '',
    efecto_sgc: p.efecto_sgc || '',
    impacto: p.impacto || '',
    influencia: p.influencia || '',
    metodo_seguimiento: p.metodo_seguimiento || '',
    frecuencia_seguimiento: p.frecuencia_seguimiento || '',
    responsable_email: p.responsable_email || '',
    estado: p.estado || 'VIGENTE',
    fecha_ultima_revision: p.fecha_ultima_revision || '',
    revisado_por: p.revisado_por || ''
  };
}
