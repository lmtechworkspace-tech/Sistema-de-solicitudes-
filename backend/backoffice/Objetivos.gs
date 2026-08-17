/**
 * Objetivos.gs — v10.0 Fase 6a, DOC-07 "Objetivos de Calidad" (§6.2 de la
 * norma: objetivos medibles, con seguimiento y responsable).
 *
 * DOC-07 es una tabla de seis objetivos con indicador, meta, frecuencia y
 * responsable. Este modulo la convierte en un tablero vivo: cada objetivo
 * acumula LECTURAS por periodo, y cada lectura se compara sola contra la meta.
 *
 * Tres decisiones que conviene tener a la vista:
 *
 * 1. Los objetivos viven en una HOJA, no en el codigo. Las 13 entradas de la
 *    revision por la direccion y las 28 clausulas ISO si son constantes,
 *    porque las define la norma. Estas las define la empresa en su DOC-07 y
 *    las ajusta ("Fecha actualizacion: Junio 2026"), asi que tienen que poder
 *    cambiar sin tocar codigo. Se guardan por AÑO para que subir una meta en
 *    2027 no reescriba contra que se midio 2026.
 *
 * 2. Solo UNO de los seis se puede calcular entero hoy. Esto no es una
 *    limitacion del modulo sino del dato disponible, y se declara explicito
 *    en vez de simularlo:
 *
 *      Obj 4  horas de formacion  AUTO      SGC_CAPACITACIONES ya lo tiene
 *      Obj 2  reclamos / servicios ASISTIDA el numerador sale de SGC_QUEJAS;
 *                                           el denominador ("total de
 *                                           servicios prestados") recien
 *                                           existe con la Fase 7
 *      Obj 1  satisfaccion         MANUAL   no hay encuesta post-servicio aun
 *      Obj 3  plazos de entrega    MANUAL   idem Fase 7 (ver nota abajo)
 *      Obj 5  nuevos servicios     MANUAL   dato comercial, fuera de SIGSO
 *      Obj 6  fidelizacion         MANUAL   dato comercial, fuera de SIGSO
 *
 *    Sobre el objetivo 3: SIGSO **si** sabe calcular cumplimiento de fechas
 *    comprometidas (Cumplimiento.gs), pero eso mide SOLICITUDES INTERNAS de
 *    soporte, no servicios entregados al cliente. Usarlo aca daria un numero
 *    con la etiqueta equivocada -- el auditor pregunta por entregas al
 *    cliente y le estariamos mostrando tickets internos. Queda MANUAL a
 *    proposito hasta que la Fase 7 traiga la evidencia de servicios.
 *
 * 3. Una lectura ya registrada guarda su propio veredicto (`cumple`). Se
 *    recalcularia distinto si mañana cambia la meta, y el historico dejaria
 *    de ser evidencia de lo que se evaluo en su momento.
 */

// Los seis objetivos tal como estan en DOC-07 v01. Es SEMILLA, no catalogo:
// se copian a la hoja al abrir un año y desde ahi se editan. Si DOC-07 se
// revisa, cambia la semilla para años nuevos y los años ya sembrados
// conservan su version.
var OBJETIVOS_DOC07_SEMILLA = [
  {
    numero: 1,
    objetivo_general: 'Satisfacción del cliente',
    objetivo_especifico: 'Medir la percepción general del cliente sobre el servicio recibido.',
    indicador: 'Calificación de satisfacción en encuesta post-servicio (escala 1-10).',
    // La meta trae DOS condiciones: el 90% es la proporcion y el "nota >= 8"
    // define que cuenta como satisfecho. O sea, el indicador es "% de
    // encuestas con nota >= 8" y la meta es >= 90%.
    meta_texto: '≥ 90% anual, con calificación ≥ nota 8',
    meta_operador: 'MAYOR_IGUAL', meta_valor: 90, unidad: 'PORCENTAJE',
    acciones: 'Aplicar encuesta de satisfacción al cliente. Analizar resultados y definir acciones de mejora.',
    frecuencia: 'ANUAL', frecuencia_texto: 'Anual (post-proyecto)',
    responsable_texto: 'Gerencia / Encargada de Administración',
    fuente: 'MANUAL', calculo: ''
  },
  {
    numero: 2,
    objetivo_general: 'Gestión de reclamos',
    objetivo_especifico: 'Reducir la cantidad de reclamos recibidos sobre el total de servicios prestados.',
    indicador: 'N.° de reclamos recibidos / Total de servicios prestados (%).',
    meta_texto: '< 2% de reclamos sobre total de servicios',
    meta_operador: 'MENOR', meta_valor: 2, unidad: 'PORCENTAJE',
    acciones: 'Implementar procedimiento formal de gestión de quejas y reclamos. Hacer seguimiento de cada caso.',
    // El documento dice "Mensual / Trimestral". Se siembra MENSUAL por ser la
    // mas exigente de las dos; es editable si la empresa prefiere trimestral.
    frecuencia: 'MENSUAL', frecuencia_texto: 'Mensual / Trimestral',
    responsable_texto: 'Encargada de Administración / Enc. de Área',
    fuente: 'ASISTIDA', calculo: 'RECLAMOS_RECIBIDOS'
  },
  {
    numero: 3,
    objetivo_general: 'Cumplimiento de plazos de entrega',
    objetivo_especifico: 'Asegurar que los servicios sean entregados dentro de los plazos comprometidos con el cliente.',
    indicador: '% de servicios entregados a tiempo respecto al total comprometido.',
    meta_texto: '≥ 90% de servicios entregados en fecha comprometida',
    meta_operador: 'MAYOR_IGUAL', meta_valor: 90, unidad: 'PORCENTAJE',
    acciones: 'Monitorear fechas de entrega por área. Establecer alertas internas. Gestionar impedimentos de forma proactiva.',
    frecuencia: 'MENSUAL', frecuencia_texto: 'Mensual / Trimestral',
    responsable_texto: 'Encargadas de Área / Gerencia',
    fuente: 'MANUAL', calculo: ''
  },
  {
    numero: 4,
    objetivo_general: 'Desarrollo y competencia del personal',
    objetivo_especifico: 'Mejorar las competencias técnicas y metodológicas de los colaboradores.',
    indicador: 'N.° de horas de formación por colaborador al año.',
    meta_texto: '≥ 5 horas de formación por colaborador/año',
    meta_operador: 'MAYOR_IGUAL', meta_valor: 5, unidad: 'HORAS',
    acciones: 'Ejecutar plan anual de capacitaciones. Registrar horas por colaborador. Evaluar impacto en desempeño.',
    frecuencia: 'SEMESTRAL', frecuencia_texto: 'Semestral',
    responsable_texto: 'Gerencia / Encargadas de Área',
    fuente: 'AUTO', calculo: 'HORAS_FORMACION'
  },
  {
    numero: 5,
    objetivo_general: 'Crecimiento por nuevos servicios',
    objetivo_especifico: 'Aumentar la contratación de servicios adicionales',
    indicador: 'N° de clientes que contratan servicios nuevos / Total de clientes activos en el periodo (%)',
    meta_texto: '≥ 15% de la cartera activa contrata un nuevo servicio anualmente.',
    meta_operador: 'MAYOR_IGUAL', meta_valor: 15, unidad: 'PORCENTAJE',
    acciones: 'Presentación proactiva de nuevos servicios en reuniones de seguimiento. Envío de reportes con propuestas de mejora u optimización para el cliente.',
    frecuencia: 'SEMESTRAL', frecuencia_texto: 'Semestral',
    responsable_texto: 'Gerencia / Enc. comercial',
    fuente: 'MANUAL', calculo: ''
  },
  {
    numero: 6,
    objetivo_general: 'Fidelización de clientes',
    objetivo_especifico: 'Mantener la cartera de clientes activos y reducir la tasa de abandono.',
    indicador: '% de clientes activos retenidos al término del período respecto al inicio.',
    meta_texto: '≥ 70% de clientes activos retenidos anualmente',
    meta_operador: 'MAYOR_IGUAL', meta_valor: 70, unidad: 'PORCENTAJE',
    acciones: 'Contacto periódico con clientes. Mejorar comunicación. Implementar planes de seguimiento y fidelización.',
    frecuencia: 'SEMESTRAL', frecuencia_texto: 'Semestral',
    responsable_texto: 'Gerencia / Encargada de administración',
    fuente: 'MANUAL', calculo: ''
  }
];

var FRECUENCIAS_OBJETIVO = [
  { clave: 'MENSUAL', etiqueta: 'Mensual', periodos: 12 },
  { clave: 'TRIMESTRAL', etiqueta: 'Trimestral', periodos: 4 },
  { clave: 'SEMESTRAL', etiqueta: 'Semestral', periodos: 2 },
  { clave: 'ANUAL', etiqueta: 'Anual', periodos: 1 }
];

var OPERADORES_META = [
  { clave: 'MAYOR_IGUAL', etiqueta: '≥ (mayor o igual que)' },
  { clave: 'MAYOR', etiqueta: '> (mayor que)' },
  { clave: 'MENOR_IGUAL', etiqueta: '≤ (menor o igual que)' },
  { clave: 'MENOR', etiqueta: '< (menor que)' }
];

var UNIDADES_INDICADOR = [
  { clave: 'PORCENTAJE', etiqueta: '%', sufijo: '%' },
  { clave: 'HORAS', etiqueta: 'horas', sufijo: ' h' },
  { clave: 'NUMERO', etiqueta: 'número', sufijo: '' }
];

var FUENTES_INDICADOR = [
  { clave: 'AUTO', etiqueta: 'Lo calcula el sistema' },
  { clave: 'ASISTIDA', etiqueta: 'El sistema aporta parte del dato' },
  { clave: 'MANUAL', etiqueta: 'Lo registra la persona responsable' }
];

var Objetivos = {

  // --- Tablero -------------------------------------------------------------
  listar: function (data, contexto) {
    var rol = rolSgc_(contexto);
    var gobierna = gobiernaSgc_(contexto, rol);
    if (!(gobierna || veTodoSgc_(contexto, rol, gobierna))) {
      return { _forbidden: true, message: 'No tienes acceso al tablero de objetivos de calidad.' };
    }

    var anio = Number((data && data.anio)) || new Date().getFullYear();
    var objetivos = objetivosDelAnio_(anio);
    var lecturas = leerFilasSeguro_(SHEETS.SGC_INDICADOR_LECTURAS).filter(esActivoSgc_);

    var filas = objetivos.map(function (o) {
      return resumenObjetivo_(o, lecturas);
    });

    return {
      anio: anio,
      puede_gestionar: gobierna,
      anios_disponibles: aniosConObjetivos_(),
      sembrado: objetivos.length > 0,
      catalogos: {
        frecuencias: FRECUENCIAS_OBJETIVO,
        operadores: OPERADORES_META,
        unidades: UNIDADES_INDICADOR,
        fuentes: FUENTES_INDICADOR
      },
      indicadores: indicadoresTablero_(filas),
      objetivos: filas
    };
  },

  getDetalle: function (data, contexto) {
    var objetivo = buscarObjetivo_(data && data.objetivo_id);
    if (!objetivo) return errorValidacion_('objetivo_id', 'Objetivo no encontrado.');
    var rol = rolSgc_(contexto);
    var gobierna = gobiernaSgc_(contexto, rol);
    if (!(gobierna || veTodoSgc_(contexto, rol, gobierna))) {
      return { _forbidden: true, message: 'No tienes acceso a este objetivo.' };
    }

    var lecturas = leerFilasSeguro_(SHEETS.SGC_INDICADOR_LECTURAS).filter(esActivoSgc_);
    return {
      objetivo: resumenObjetivo_(objetivo, lecturas),
      puede_gestionar: gobierna,
      periodos: periodosDelAnio_(objetivo.frecuencia, Number(objetivo.anio)),
      lecturas: lecturasDeObjetivo_(objetivo, lecturas).map(function (l) {
        return {
          lectura_id: l.lectura_id,
          periodo: l.periodo,
          periodo_etiqueta: etiquetaPeriodo_(l.periodo),
          valor: Number(l.valor),
          numerador: l.numerador === '' ? null : Number(l.numerador),
          denominador: l.denominador === '' ? null : Number(l.denominador),
          cumple: esVerdaderoSgc_(l.cumple),
          origen: l.origen,
          detalle: parsearDetalleLectura_(l.detalle),
          observaciones: l.observaciones,
          registrado_por: l.registrado_por,
          fecha_registro: l.fecha_registro
        };
      })
    };
  },

  // --- Abrir el año --------------------------------------------------------
  // Sembrar es un acto explicito y no algo que pase solo al entrar: deja
  // registrado quien abrio el año y contra que version de DOC-07.
  sembrarAnio: function (data, contexto) {
    if (!gobiernaSgc_(contexto, rolSgc_(contexto))) {
      return { _forbidden: true, message: 'Solo el Encargado SGC o un administrador pueden abrir el año de objetivos.' };
    }
    var anio = Number(data && data.anio);
    if (!anio || anio < 2000 || anio > 2200) {
      return errorValidacion_('anio', 'Indica un año válido.');
    }
    if (objetivosDelAnio_(anio).length) {
      return errorValidacion_('anio', 'El año ' + anio + ' ya tiene objetivos cargados.');
    }

    // Si el año anterior existe, se copia DE AHI: conserva los ajustes que la
    // empresa ya hizo (metas, responsables) en vez de devolverlos a la
    // semilla original de DOC-07 v01.
    var base = objetivosDelAnio_(anio - 1);
    var origen = base.length ? 'AÑO_ANTERIOR' : 'DOC-07';
    var plantilla = base.length ? base.map(function (o) {
      return {
        numero: Number(o.numero),
        objetivo_general: o.objetivo_general, objetivo_especifico: o.objetivo_especifico,
        indicador: o.indicador, meta_texto: o.meta_texto,
        meta_operador: o.meta_operador, meta_valor: Number(o.meta_valor), unidad: o.unidad,
        acciones: o.acciones, frecuencia: o.frecuencia, frecuencia_texto: o.frecuencia_texto,
        responsable_texto: o.responsable_texto, responsable_email: o.responsable_email,
        fuente: o.fuente, calculo: o.calculo
      };
    }) : OBJETIVOS_DOC07_SEMILLA;

    var ahora = new Date().toISOString();
    var email = (contexto && contexto.email) || '';
    plantilla.forEach(function (p) {
      agregarFila_(SHEETS.SGC_OBJETIVOS, {
        objetivo_id: Utilities.getUuid(),
        anio: anio,
        numero: p.numero,
        objetivo_general: p.objetivo_general,
        objetivo_especifico: p.objetivo_especifico,
        indicador: p.indicador,
        meta_texto: p.meta_texto,
        meta_operador: p.meta_operador,
        meta_valor: p.meta_valor,
        unidad: p.unidad,
        acciones: p.acciones,
        frecuencia: p.frecuencia,
        frecuencia_texto: p.frecuencia_texto,
        responsable_texto: p.responsable_texto,
        responsable_email: p.responsable_email || '',
        fuente: p.fuente,
        calculo: p.calculo,
        creado_por: email,
        fecha_creacion: ahora,
        activa: true
      });
    });

    registrarLogSgc_('SGC_OBJETIVOS_ANIO_ABIERTO', anio + ' (' + origen + ')', contexto);
    return { ok: true, anio: anio, creados: plantilla.length, origen: origen };
  },

  // --- Edicion del objetivo ------------------------------------------------
  guardar: function (data, contexto) {
    if (!gobiernaSgc_(contexto, rolSgc_(contexto))) {
      return { _forbidden: true, message: 'Solo el Encargado SGC o un administrador pueden editar los objetivos.' };
    }
    var objetivo = buscarObjetivo_(data && data.objetivo_id);
    if (!objetivo) return errorValidacion_('objetivo_id', 'Objetivo no encontrado.');

    var indicador = String(data.indicador || '').trim();
    if (!indicador) {
      return errorValidacion_('indicador', 'El indicador es obligatorio: sin él el objetivo no es medible (§6.2).');
    }
    var metaValor = Number(data.meta_valor);
    if (!isFinite(metaValor)) {
      return errorValidacion_('meta_valor', 'La meta tiene que ser un número para poder compararla.');
    }
    if (!operadorValido_(data.meta_operador)) {
      return errorValidacion_('meta_operador', 'Operador de meta desconocido.');
    }
    if (!frecuenciaValida_(data.frecuencia)) {
      return errorValidacion_('frecuencia', 'Frecuencia de seguimiento desconocida.');
    }
    var email = String(data.responsable_email || '').trim();
    if (email && !esEmailValidoSgc_(email)) {
      return errorValidacion_('responsable_email', 'El correo del responsable no es válido.');
    }

    // La fuente y el calculo NO se editan desde la pantalla: dependen de que
    // datos existen en el sistema, no de una preferencia. Cambiarlos a mano
    // dejaria un objetivo marcado AUTO sin nada que lo calcule.
    var campos = {
      objetivo_general: String(data.objetivo_general || '').trim(),
      objetivo_especifico: String(data.objetivo_especifico || '').trim(),
      indicador: indicador,
      meta_texto: String(data.meta_texto || '').trim(),
      meta_operador: data.meta_operador,
      meta_valor: metaValor,
      unidad: unidadValida_(data.unidad) ? data.unidad : 'PORCENTAJE',
      acciones: String(data.acciones || '').trim(),
      frecuencia: data.frecuencia,
      frecuencia_texto: String(data.frecuencia_texto || '').trim(),
      responsable_texto: String(data.responsable_texto || '').trim(),
      responsable_email: email
    };

    var ok = actualizarFilaPorId_(SHEETS.SGC_OBJETIVOS, 'objetivo_id', objetivo.objetivo_id, campos);
    registrarLogSgc_('SGC_OBJETIVO_EDITADO', objetivo.anio + '/' + objetivo.numero, contexto);
    return ok;
  },

  // --- Lecturas ------------------------------------------------------------
  // Lo que el sistema puede aportar para un periodo, ANTES de guardar nada.
  // Mismo criterio que "Traer datos del sistema" del acta de revision: el
  // sistema pone el dato, la persona confirma y firma.
  sugerirLectura: function (data, contexto) {
    var objetivo = buscarObjetivo_(data && data.objetivo_id);
    if (!objetivo) return errorValidacion_('objetivo_id', 'Objetivo no encontrado.');
    if (!gobiernaSgc_(contexto, rolSgc_(contexto))) {
      return { _forbidden: true, message: 'Solo el Encargado SGC o un administrador pueden registrar lecturas.' };
    }
    var periodo = String((data && data.periodo) || '').trim();
    if (!periodoValido_(periodo, objetivo)) {
      return errorValidacion_('periodo', 'El período no corresponde a la frecuencia de este objetivo.');
    }
    return calcularIndicador_(objetivo, periodo);
  },

  registrarLectura: function (data, contexto) {
    if (!gobiernaSgc_(contexto, rolSgc_(contexto))) {
      return { _forbidden: true, message: 'Solo el Encargado SGC o un administrador pueden registrar lecturas.' };
    }
    var objetivo = buscarObjetivo_(data && data.objetivo_id);
    if (!objetivo) return errorValidacion_('objetivo_id', 'Objetivo no encontrado.');

    var periodo = String(data.periodo || '').trim();
    if (!periodoValido_(periodo, objetivo)) {
      return errorValidacion_('periodo', 'El período no corresponde a la frecuencia de este objetivo.');
    }

    var valor = Number(data.valor);
    if (!isFinite(valor)) {
      return errorValidacion_('valor', 'El valor medido es obligatorio y tiene que ser un número.');
    }
    if (objetivo.unidad === 'PORCENTAJE' && (valor < 0 || valor > 100)) {
      return errorValidacion_('valor', 'Un porcentaje va entre 0 y 100.');
    }
    if (valor < 0) return errorValidacion_('valor', 'El valor no puede ser negativo.');

    var numerador = data.numerador === '' || data.numerador === undefined || data.numerador === null
      ? '' : Number(data.numerador);
    var denominador = data.denominador === '' || data.denominador === undefined || data.denominador === null
      ? '' : Number(data.denominador);
    if (denominador !== '' && denominador <= 0) {
      return errorValidacion_('denominador', 'El denominador tiene que ser mayor que cero.');
    }

    // Una lectura por (objetivo, periodo): volver a medir el mismo mes
    // reemplaza, no acumula. Se conserva la anterior como anulada para no
    // perder que se habia informado antes.
    var previa = leerFilasSeguro_(SHEETS.SGC_INDICADOR_LECTURAS).filter(function (l) {
      return esActivoSgc_(l) && l.objetivo_id === objetivo.objetivo_id && l.periodo === periodo;
    })[0];
    if (previa) {
      actualizarFilaPorId_(SHEETS.SGC_INDICADOR_LECTURAS, 'lectura_id', previa.lectura_id, { activa: false });
    }

    var lectura = {
      lectura_id: Utilities.getUuid(),
      objetivo_id: objetivo.objetivo_id,
      anio: Number(objetivo.anio),
      periodo: periodo,
      valor: valor,
      numerador: numerador,
      denominador: denominador,
      cumple: cumpleMeta_(valor, objetivo),
      origen: data.origen === 'AUTO' ? 'AUTO' : 'MANUAL',
      detalle: data.detalle ? JSON.stringify(data.detalle) : '',
      observaciones: String(data.observaciones || '').trim(),
      registrado_por: (contexto && contexto.email) || '',
      fecha_registro: new Date().toISOString(),
      activa: true
    };
    agregarFila_(SHEETS.SGC_INDICADOR_LECTURAS, lectura);
    registrarLogSgc_('SGC_LECTURA_REGISTRADA',
      objetivo.objetivo_general + ' ' + periodo + ': ' + valor, contexto);

    // Un objetivo que no cumple es justamente lo que §9.3.2 quiere que la
    // Direccion vea. Se avisa al momento, no recien en la revision anual.
    if (!lectura.cumple) avisarObjetivoIncumplido_(objetivo, lectura);

    return { ok: true, lectura_id: lectura.lectura_id, cumple: lectura.cumple, reemplazo: !!previa };
  },

  anularLectura: function (data, contexto) {
    if (!gobiernaSgc_(contexto, rolSgc_(contexto))) {
      return { _forbidden: true, message: 'Solo el Encargado SGC o un administrador pueden anular lecturas.' };
    }
    var motivo = String((data && data.motivo) || '').trim();
    if (!motivo) return errorValidacion_('motivo', 'Indica por qué se anula la lectura.');
    var lectura = leerFilasSeguro_(SHEETS.SGC_INDICADOR_LECTURAS).filter(function (l) {
      return l.lectura_id === (data && data.lectura_id) && esActivoSgc_(l);
    })[0];
    if (!lectura) return errorValidacion_('lectura_id', 'Lectura no encontrada.');

    actualizarFilaPorId_(SHEETS.SGC_INDICADOR_LECTURAS, 'lectura_id', lectura.lectura_id, {
      activa: false,
      observaciones: String(lectura.observaciones || '') + ' [ANULADA: ' + motivo + ']'
    });
    registrarLogSgc_('SGC_LECTURA_ANULADA', lectura.periodo + ' — ' + motivo, contexto);
    return { ok: true };
  },

  // --- Aviso de lectura pendiente ------------------------------------------
  // Colgado del trigger diario de las 09:00 (Triggers.gs). Un objetivo cuyo
  // periodo ya cerro y sigue sin medirse es un incumplimiento de §9.1.1: la
  // organizacion tiene que "evaluar el desempeño", y no medir es no evaluar.
  alertarLecturasPendientes: function () {
    var hoy = new Date();
    var anio = hoy.getFullYear();
    var objetivos = objetivosDelAnio_(anio);
    if (!objetivos.length) return [];

    var lecturas = leerFilasSeguro_(SHEETS.SGC_INDICADOR_LECTURAS).filter(esActivoSgc_);
    var pendientes = [];
    objetivos.forEach(function (o) {
      periodosDelAnio_(o.frecuencia, anio).forEach(function (p) {
        if (!p.cerrado) return; // el periodo en curso todavia no se puede medir
        var medido = lecturas.some(function (l) {
          return l.objetivo_id === o.objetivo_id && l.periodo === p.clave;
        });
        if (!medido) {
          pendientes.push({ objetivo: o, periodo: p });
        }
      });
    });
    if (!pendientes.length) return [];

    var lineas = pendientes.map(function (x) {
      return '- ' + x.objetivo.objetivo_general + ' (' + etiquetaPeriodo_(x.periodo.clave) + ')';
    }).join('\n');
    var asunto = 'SIGSO — Objetivos de calidad: ' + pendientes.length +
      (pendientes.length === 1 ? ' lectura pendiente' : ' lecturas pendientes');
    var cuerpo = 'Hay períodos ya cerrados sin su lectura registrada:\n\n' + lineas +
      '\n\nMedir cada objetivo en su frecuencia es lo que sostiene el seguimiento de §9.1.1.';

    // Una clave por dia: el aviso se repite mientras siga pendiente, pero
    // como mucho una vez al dia (mismo patron que el resto del SGC).
    var claveDia = claveDia_(hoy, 'America/Santiago');
    return encargadosSgc_().map(function (email) {
      encolarNotificacionApp_(email, 'SGC_OBJETIVOS', 'Lecturas de objetivos pendientes',
        pendientes.length + (pendientes.length === 1 ? ' período cerrado sin medir.' : ' períodos cerrados sin medir.'),
        'calidad', 'Ver objetivos', 72);
      return enviarCorreo_('SGC-OBJETIVOS', email, 'SGC_OBJETIVOS_PENDIENTES_' + claveDia,
        asunto, cuerpo, VENTANA_DEDUP_SLA_VENCIDO_MINUTOS);
    });
  },

  // --- Entrada 8 de la revision por la direccion (Fase 5b) -----------------
  // Devuelve el texto que prellena el item 8 del acta. Vive aca y no en
  // RevisionDireccion.gs por la misma razon que los demas resumenes: el que
  // sabe leer un objetivo es este modulo.
  resumenParaRevision: function (anio) {
    var objetivos = objetivosDelAnio_(anio);
    if (!objetivos.length) {
      return 'No hay objetivos de calidad cargados para ' + anio +
        ' en el tablero (DOC-07), así que no es posible informar su grado de logro.';
    }
    var lecturas = leerFilasSeguro_(SHEETS.SGC_INDICADOR_LECTURAS).filter(esActivoSgc_);
    var conLectura = 0, cumplen = 0, sinMedir = [];
    objetivos.forEach(function (o) {
      var r = resumenObjetivo_(o, lecturas);
      if (r.ultima_lectura) {
        conLectura++;
        if (r.ultima_lectura.cumple) cumplen++;
      } else {
        sinMedir.push(o.objetivo_general);
      }
    });

    return 'DOC-07 define ' + objetivos.length + ' objetivos de calidad para ' + anio + '. ' +
      (conLectura
        ? conLectura + ' tienen medición registrada, y de esos ' + cumplen + ' alcanzan su meta.'
        : 'Ninguno tiene mediciones registradas todavía.') +
      (sinMedir.length
        ? ' Sin medir: ' + sinMedir.join(', ') + '.'
        : '');
  }
};

// --- calculos automaticos ----------------------------------------------------

// Cada clave sabe calcular su indicador para un periodo. Devuelven siempre la
// misma forma: {fuente, valor, numerador, denominador, detalle, nota,
// completo}. `completo: false` = el sistema aporto parte y falta que la
// persona ponga el resto (caso ASISTIDA).
var CALCULOS_INDICADOR_SGC = {

  // Objetivo 4. Horas de formacion por colaborador en el AÑO (no en el
  // periodo): la meta de DOC-07 es anual ("5 horas por colaborador/año"),
  // asi que una lectura semestral informa el acumulado del año a esa fecha.
  HORAS_FORMACION: function (objetivo, periodo) {
    var anio = Number(objetivo.anio);
    var porPersona = horasFormacionPorPersonaSgc_(anio);
    if (!porPersona.length) {
      return {
        fuente: 'AUTO', valor: 0, numerador: '', denominador: '', completo: true,
        detalle: { bajo_meta: [] },
        nota: 'No hay personal vigente cargado, así que el promedio de horas es 0.'
      };
    }
    var total = porPersona.reduce(function (s, p) { return s + p.horas; }, 0);
    var promedio = Math.round((total / porPersona.length) * 10) / 10;
    var meta = Number(objetivo.meta_valor);
    var bajoMeta = porPersona.filter(function (p) { return p.horas < meta; });

    return {
      fuente: 'AUTO',
      valor: promedio,
      numerador: total,
      denominador: porPersona.length,
      completo: true,
      detalle: {
        bajo_meta: bajoMeta.map(function (p) { return { nombre: p.nombre, horas: p.horas }; })
      },
      nota: 'Promedio de ' + promedio + ' h por colaborador (' + total + ' h entre ' +
        porPersona.length + ' personas). ' +
        (bajoMeta.length
          ? bajoMeta.length + ' bajo la meta de ' + meta + ' h.'
          : 'Todos alcanzan la meta.')
    };
  },

  // Objetivo 2. El sistema sabe el NUMERADOR (los reclamos que entraron por
  // el canal formal, FO-PRO-07-01) pero no el denominador: "total de
  // servicios prestados" es justamente lo que trae la Fase 7. Por eso
  // devuelve completo:false -- la persona pone el denominador y el sistema
  // calcula el porcentaje.
  RECLAMOS_RECIBIDOS: function (objetivo, periodo) {
    var rango = rangoDePeriodo_(periodo);
    var reclamos = leerFilasSeguro_(SHEETS.SGC_QUEJAS).filter(function (q) {
      if (!esVerdaderoSgc_(q.activa)) return false;
      // Solo QUEJA y RECLAMACION: felicitaciones y consultas no son reclamos.
      if (q.tipo !== 'QUEJA' && q.tipo !== 'RECLAMACION') return false;
      var f = new Date(q.fecha_envio);
      return !isNaN(f.getTime()) && f >= rango.desde && f <= rango.hasta;
    });

    return {
      fuente: 'ASISTIDA',
      valor: null,
      numerador: reclamos.length,
      denominador: '',
      completo: false,
      detalle: null,
      nota: 'En ' + etiquetaPeriodo_(periodo) + ' se recibieron ' + reclamos.length +
        (reclamos.length === 1 ? ' reclamo' : ' reclamos') +
        ' por el canal formal. Falta el total de servicios prestados en el período ' +
        '(ese dato lo traerá la evidencia de servicios); al escribirlo se calcula el porcentaje.'
    };
  }
};

function calcularIndicador_(objetivo, periodo) {
  var calculo = CALCULOS_INDICADOR_SGC[objetivo.calculo];
  if (!calculo) {
    return {
      fuente: 'MANUAL', valor: null, numerador: '', denominador: '',
      completo: false, detalle: null,
      nota: 'Este indicador se registra a mano: el sistema todavía no tiene la fuente de datos que lo alimenta.'
    };
  }
  return calculo(objetivo, periodo);
}

// --- periodos ----------------------------------------------------------------

// Claves ordenables y sin ambiguedad: '2026-M03', '2026-T2', '2026-S1', '2026'.
// La forma la impone la frecuencia del objetivo, asi que uno semestral nunca
// puede recibir una lectura mensual.
function periodosDelAnio_(frecuencia, anio) {
  var hoy = new Date();
  var lista = [];
  var cerrado = function (finMes) {
    // Un periodo esta cerrado cuando ya paso su ultimo mes por completo.
    var fin = new Date(Date.UTC(anio, finMes, 1)); // primer dia del mes siguiente
    return hoy >= fin;
  };

  if (frecuencia === 'MENSUAL') {
    for (var m = 1; m <= 12; m++) {
      lista.push({ clave: anio + '-M' + ('0' + m).slice(-2), cerrado: cerrado(m) });
    }
  } else if (frecuencia === 'TRIMESTRAL') {
    for (var t = 1; t <= 4; t++) {
      lista.push({ clave: anio + '-T' + t, cerrado: cerrado(t * 3) });
    }
  } else if (frecuencia === 'SEMESTRAL') {
    for (var s = 1; s <= 2; s++) {
      lista.push({ clave: anio + '-S' + s, cerrado: cerrado(s * 6) });
    }
  } else {
    lista.push({ clave: String(anio), cerrado: cerrado(12) });
  }

  return lista.map(function (p) {
    return { clave: p.clave, etiqueta: etiquetaPeriodo_(p.clave), cerrado: p.cerrado };
  });
}

var MESES_SGC = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio',
  'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];

function etiquetaPeriodo_(clave) {
  var s = String(clave || '');
  var m = s.match(/^(\d{4})-M(\d{2})$/);
  if (m) return MESES_SGC[Number(m[2]) - 1] + ' ' + m[1];
  var t = s.match(/^(\d{4})-T(\d)$/);
  if (t) return 'trimestre ' + t[2] + ' de ' + t[1];
  var e = s.match(/^(\d{4})-S(\d)$/);
  if (e) return (e[2] === '1' ? 'primer' : 'segundo') + ' semestre de ' + e[1];
  return s;
}

// Rango de fechas [desde, hasta] que cubre una clave de periodo. En UTC, por
// la misma razon que el resto del SGC: las claves son dias calendario, no
// instantes, y reinterpretarlas en zona local corre los bordes un dia.
function rangoDePeriodo_(clave) {
  var s = String(clave || '');
  var m = s.match(/^(\d{4})-M(\d{2})$/);
  if (m) {
    var anioM = Number(m[1]), mes = Number(m[2]) - 1;
    return { desde: new Date(Date.UTC(anioM, mes, 1)), hasta: new Date(Date.UTC(anioM, mes + 1, 0, 23, 59, 59)) };
  }
  var t = s.match(/^(\d{4})-T(\d)$/);
  if (t) {
    var anioT = Number(t[1]), ini = (Number(t[2]) - 1) * 3;
    return { desde: new Date(Date.UTC(anioT, ini, 1)), hasta: new Date(Date.UTC(anioT, ini + 3, 0, 23, 59, 59)) };
  }
  var e = s.match(/^(\d{4})-S(\d)$/);
  if (e) {
    var anioS = Number(e[1]), iniS = (Number(e[2]) - 1) * 6;
    return { desde: new Date(Date.UTC(anioS, iniS, 1)), hasta: new Date(Date.UTC(anioS, iniS + 6, 0, 23, 59, 59)) };
  }
  var anio = Number(s) || new Date().getFullYear();
  return { desde: new Date(Date.UTC(anio, 0, 1)), hasta: new Date(Date.UTC(anio, 11, 31, 23, 59, 59)) };
}

function periodoValido_(periodo, objetivo) {
  return periodosDelAnio_(objetivo.frecuencia, Number(objetivo.anio)).some(function (p) {
    return p.clave === periodo;
  });
}

// --- helpers -----------------------------------------------------------------

function buscarObjetivo_(objetivoId) {
  if (!objetivoId) return null;
  return leerFilasSeguro_(SHEETS.SGC_OBJETIVOS).filter(function (o) {
    return o.objetivo_id === objetivoId && esActivoSgc_(o);
  })[0] || null;
}

function objetivosDelAnio_(anio) {
  return leerFilasSeguro_(SHEETS.SGC_OBJETIVOS)
    .filter(function (o) { return esActivoSgc_(o) && Number(o.anio) === Number(anio); })
    .sort(function (a, b) { return Number(a.numero) - Number(b.numero); });
}

function aniosConObjetivos_() {
  var vistos = {};
  leerFilasSeguro_(SHEETS.SGC_OBJETIVOS).forEach(function (o) {
    if (esActivoSgc_(o)) vistos[Number(o.anio)] = true;
  });
  return Object.keys(vistos).map(Number).sort(function (a, b) { return b - a; });
}

function lecturasDeObjetivo_(objetivo, lecturas) {
  return lecturas
    .filter(function (l) { return l.objetivo_id === objetivo.objetivo_id; })
    .sort(function (a, b) { return String(a.periodo).localeCompare(String(b.periodo)); });
}

// Compara el valor contra la meta segun el operador. Es la unica funcion que
// decide si un objetivo se cumple: si esto queda en la pantalla, dos vistas
// terminan opinando distinto sobre el mismo numero.
function cumpleMeta_(valor, objetivo) {
  var meta = Number(objetivo.meta_valor);
  var v = Number(valor);
  if (!isFinite(meta) || !isFinite(v)) return false;
  switch (objetivo.meta_operador) {
    case 'MAYOR_IGUAL': return v >= meta;
    case 'MAYOR': return v > meta;
    case 'MENOR_IGUAL': return v <= meta;
    case 'MENOR': return v < meta;
    default: return false;
  }
}

function resumenObjetivo_(o, lecturas) {
  var propias = lecturasDeObjetivo_(o, lecturas);
  var ultima = propias.length ? propias[propias.length - 1] : null;
  var periodos = periodosDelAnio_(o.frecuencia, Number(o.anio));
  var cerrados = periodos.filter(function (p) { return p.cerrado; });
  var medidos = cerrados.filter(function (p) {
    return propias.some(function (l) { return l.periodo === p.clave; });
  });

  return {
    objetivo_id: o.objetivo_id,
    anio: Number(o.anio),
    numero: Number(o.numero),
    objetivo_general: o.objetivo_general,
    objetivo_especifico: o.objetivo_especifico,
    indicador: o.indicador,
    meta_texto: o.meta_texto,
    meta_operador: o.meta_operador,
    meta_valor: Number(o.meta_valor),
    unidad: o.unidad,
    acciones: o.acciones,
    frecuencia: o.frecuencia,
    frecuencia_texto: o.frecuencia_texto,
    responsable_texto: o.responsable_texto,
    responsable_email: o.responsable_email,
    fuente: o.fuente,
    calculo: o.calculo,
    total_periodos: periodos.length,
    periodos_cerrados: cerrados.length,
    periodos_medidos: medidos.length,
    // Señal accionable: no es lo mismo "no cumple" que "nadie lo midio".
    // Las dos son hallazgos, pero de distinto tipo.
    lecturas_pendientes: cerrados.length - medidos.length,
    ultima_lectura: ultima ? {
      periodo: ultima.periodo,
      periodo_etiqueta: etiquetaPeriodo_(ultima.periodo),
      valor: Number(ultima.valor),
      cumple: esVerdaderoSgc_(ultima.cumple),
      fecha_registro: ultima.fecha_registro
    } : null,
    tendencia: propias.slice(-6).map(function (l) {
      return { periodo: l.periodo, valor: Number(l.valor), cumple: esVerdaderoSgc_(l.cumple) };
    })
  };
}

function indicadoresTablero_(filas) {
  var ind = { total: filas.length, cumplen: 0, no_cumplen: 0, sin_medir: 0, lecturas_pendientes: 0 };
  filas.forEach(function (f) {
    if (!f.ultima_lectura) ind.sin_medir++;
    else if (f.ultima_lectura.cumple) ind.cumplen++;
    else ind.no_cumplen++;
    ind.lecturas_pendientes += f.lecturas_pendientes;
  });
  return ind;
}

function parsearDetalleLectura_(valor) {
  if (!valor) return null;
  try { return JSON.parse(valor); } catch (err) { return null; }
}

function operadorValido_(clave) {
  return OPERADORES_META.some(function (o) { return o.clave === clave; });
}

function frecuenciaValida_(clave) {
  return FRECUENCIAS_OBJETIVO.some(function (f) { return f.clave === clave; });
}

function unidadValida_(clave) {
  return UNIDADES_INDICADOR.some(function (u) { return u.clave === clave; });
}

function avisarObjetivoIncumplido_(objetivo, lectura) {
  var sufijo = objetivo.unidad === 'PORCENTAJE' ? '%' : (objetivo.unidad === 'HORAS' ? ' h' : '');
  var asunto = 'SIGSO — Objetivo de calidad sin cumplir: ' + objetivo.objetivo_general;
  var cuerpo = objetivo.objetivo_general + ' midió ' + lectura.valor + sufijo + ' en ' +
    etiquetaPeriodo_(lectura.periodo) + ', contra una meta de ' + objetivo.meta_texto + '.\n\n' +
    'Indicador: ' + objetivo.indicador + '\n' +
    'Responsable: ' + (objetivo.responsable_texto || '—') + '\n\n' +
    'Un objetivo que no se alcanza es entrada obligatoria de la revisión por la dirección (§9.3.2 e).';

  encargadosSgc_().forEach(function (email) {
    enviarCorreo_('SGC-OBJETIVOS', email, 'SGC_OBJETIVO_INCUMPLIDO_' + lectura.lectura_id,
      asunto, cuerpo);
    encolarNotificacionApp_(email, 'SGC_OBJETIVOS', 'Objetivo sin cumplir',
      objetivo.objetivo_general + ' midió ' + lectura.valor + sufijo + ' (meta: ' + objetivo.meta_texto + ').',
      'calidad', 'Ver objetivos', 72);
  });
}
