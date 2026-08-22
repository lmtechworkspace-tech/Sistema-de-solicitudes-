/**
 * Indicadores.gs — v11.0 Fase 6: indicadores de proceso (§9.1.1).
 *
 * Los SGC_OBJETIVOS son los seis del DOC-07: corporativos, anuales, fijados
 * por la Direccion. Un indicador de PROCESO es otra cosa -- mide como va un
 * proceso concreto, lo define su responsable y no se reabre cada enero.
 *
 * Esta fase no es un capricho de completitud: la debilidad D1 del FODA de la
 * empresa dice, textual, "No se han establecido, definido e implementado
 * indicadores de gestion (KPI) en todas las areas", y la accion del riesgo
 * R1 es "Definir e implementar KPIs por area alineados a los objetivos de
 * calidad del SGC". Esto es la herramienta para hacerlo.
 *
 * Tres decisiones:
 *
 * 1. Hoja aparte, no generalizar SGC_OBJETIVOS. Los objetivos se guardan POR
 *    AÑO a proposito (subir una meta en 2027 no puede reescribir contra que
 *    se midio 2026). Un indicador de proceso vive mientras viva el proceso;
 *    mezclarlos obligaria a duplicarlos cada enero sin motivo.
 *
 * 2. Las LECTURAS se comparten. `SGC_INDICADOR_LECTURAS` gano un
 *    `indicador_id` aditivo. Todo lo que ya existia cruza por `objetivo_id`,
 *    asi que estas filas son invisibles para el tablero de objetivos -- lo
 *    verifique antes de escribir una linea, porque romper la Fase 6a era el
 *    riesgo real de esta fase.
 *
 * 3. Hay un escalon intermedio: CUMPLE / ALERTA / NO_CUMPLE. Sin tolerancia
 *    solo hay verde y rojo, y un 88% contra una meta de 90% se ve igual de
 *    grave que un 40%. Eso es justo lo que impide priorizar.
 *
 * Reutiliza de Objetivos.gs los catalogos (frecuencias, operadores, unidades,
 * fuentes), el calendario de periodos y `cumpleMeta_`. No se copian: si la
 * empresa cambia una frecuencia, tiene que cambiar en un solo lugar.
 */

var ESTADOS_INDICADOR = ['ACTIVO', 'SUSPENDIDO'];

// Veredicto de una lectura contra su meta y su tolerancia.
var VEREDICTO_INDICADOR = { CUMPLE: 'CUMPLE', ALERTA: 'ALERTA', NO_CUMPLE: 'NO_CUMPLE' };

var Indicadores = {

  listar: function (data, contexto) {
    var rol = rolSgc_(contexto);
    var gobierna = gobiernaSgc_(contexto, rol);
    if (!(gobierna || veTodoSgc_(contexto, rol, gobierna))) {
      return { _forbidden: true, message: 'No tienes acceso al tablero de indicadores.' };
    }

    var anio = Number((data && data.anio)) || new Date().getFullYear();
    var indicadores = indicadoresActivos_();
    var lecturas = leerFilasSeguro_(SHEETS.SGC_INDICADOR_LECTURAS).filter(function (l) {
      return esActivoSgc_(l) && l.indicador_id;
    });

    var procesos = (typeof procesosActivos_ === 'function') ? procesosActivos_() : [];
    var nombreProceso = {};
    procesos.forEach(function (p) { nombreProceso[p.proceso_id] = p.codigo + ' — ' + p.nombre; });

    var objetivos = leerFilasSeguro_(SHEETS.SGC_OBJETIVOS).filter(esActivoSgc_);
    var nombreObjetivo = {};
    objetivos.forEach(function (o) { nombreObjetivo[o.objetivo_id] = 'OBJ-' + o.numero + ': ' + o.objetivo_general; });

    var filas = indicadores.map(function (i) {
      return resumenIndicador_(i, lecturas, anio, nombreProceso[i.proceso_id] || '', nombreObjetivo[i.objetivo_id] || '');
    });

    return {
      anio: anio,
      puede_gestionar: gobierna,
      catalogos: {
        frecuencias: FRECUENCIAS_OBJETIVO,
        operadores: OPERADORES_META,
        unidades: UNIDADES_INDICADOR,
        fuentes: FUENTES_INDICADOR
      },
      procesos: procesos.map(function (p) {
        return { proceso_id: p.proceso_id, codigo: p.codigo, nombre: p.nombre, nivel: p.nivel };
      }),
      objetivos: objetivos.map(function (o) {
        return { objetivo_id: o.objetivo_id, numero: Number(o.numero), nombre: o.objetivo_general, anio: Number(o.anio) };
      }),
      indicadores: filas,
      resumen: resumenTableroIndicadores_(filas, procesos)
    };
  },

  guardar: function (data, contexto) {
    var rol = rolSgc_(contexto);
    if (!gobiernaSgc_(contexto, rol)) {
      return { _forbidden: true, message: 'Solo el Encargado del SGC puede definir indicadores.' };
    }

    var val = validarIndicador_(data);
    if (val.error) return { ok: false, message: val.error };

    var ahora = new Date().toISOString();
    if (data.indicador_id) {
      var actual = indicadoresActivos_().filter(function (i) { return i.indicador_id === data.indicador_id; })[0];
      if (!actual) return { ok: false, message: 'No se encontró el indicador.' };
      actualizarFilaPorId_(SHEETS.SGC_INDICADORES, 'indicador_id', actual.indicador_id, val.datos);
      registrarLogSgc_('SGC_INDICADOR_EDITADO', actual.codigo + ' actualizado', contexto);
      return { ok: true, indicador_id: actual.indicador_id, message: 'Indicador actualizado.' };
    }

    var campos = val.datos;
    campos.indicador_id = Utilities.getUuid();
    if (!campos.codigo) campos.codigo = siguienteCodigoIndicador_();
    campos.creado_por = (contexto && contexto.email) || '';
    campos.fecha_creacion = ahora;
    campos.activa = true;
    agregarFila_(SHEETS.SGC_INDICADORES, campos);
    registrarLogSgc_('SGC_INDICADOR_CREADO', campos.codigo + ' ' + campos.nombre, contexto);
    return { ok: true, indicador_id: campos.indicador_id, message: 'Indicador creado.' };
  },

  anular: function (data, contexto) {
    var rol = rolSgc_(contexto);
    if (!gobiernaSgc_(contexto, rol)) {
      return { _forbidden: true, message: 'Solo el Encargado del SGC puede quitar indicadores.' };
    }
    var i = indicadoresActivos_().filter(function (x) { return x.indicador_id === data.indicador_id; })[0];
    if (!i) return { ok: false, message: 'No se encontró el indicador.' };
    actualizarFilaPorId_(SHEETS.SGC_INDICADORES, 'indicador_id', i.indicador_id, { activa: false });
    registrarLogSgc_('SGC_INDICADOR_QUITADO', i.codigo + ' quitado', contexto);
    return { ok: true, message: 'Indicador quitado. Sus lecturas se conservan como historial.' };
  },

  /**
   * Registra la medicion de un periodo. Mismo criterio que las lecturas de
   * objetivo: una por (indicador, periodo), y volver a medir REEMPLAZA
   * conservando la anterior como anulada.
   *
   * El veredicto se PERSISTE. La meta puede cambiar el año que viene y lo
   * que se midio este tiene que seguir diciendo lo que dijo entonces.
   */
  registrarLectura: function (data, contexto) {
    var rol = rolSgc_(contexto);
    if (!gobiernaSgc_(contexto, rol)) {
      return { _forbidden: true, message: 'Solo el Encargado del SGC puede registrar mediciones.' };
    }

    var ind = indicadoresActivos_().filter(function (i) { return i.indicador_id === (data && data.indicador_id); })[0];
    if (!ind) return { ok: false, message: 'No se encontró el indicador.' };

    var periodo = String((data && data.periodo) || '').trim();
    if (!periodo) return { ok: false, message: 'Indica el período que estás midiendo.' };

    var anio = Number(String(periodo).slice(0, 4));
    if (!isFinite(anio)) return { ok: false, message: 'El período tiene que empezar por el año.' };
    // La clave de periodo tiene que corresponder a la frecuencia: un
    // indicador semestral no acepta una lectura de marzo.
    var validos = periodosDelAnio_(ind.frecuencia, anio).map(function (p) { return p.clave; });
    if (validos.indexOf(periodo) === -1) {
      return {
        ok: false,
        message: 'El período ' + periodo + ' no corresponde a la frecuencia ' +
          etiquetaFrecuenciaIndicador_(ind.frecuencia) + '. Válidos: ' + validos.join(', ') + '.'
      };
    }

    var num = data.numerador === '' || data.numerador === undefined || data.numerador === null ? null : Number(data.numerador);
    var den = data.denominador === '' || data.denominador === undefined || data.denominador === null ? null : Number(data.denominador);
    var valor;

    if (num !== null && den !== null) {
      if (!isFinite(num) || !isFinite(den)) return { ok: false, message: 'El numerador y el denominador tienen que ser números.' };
      if (den === 0) return { ok: false, message: 'El denominador no puede ser cero.' };
      // Se deriva y se guardan las dos partes: un 1,8% sin numerador ni
      // denominador no se puede auditar (¿1,8% de qué?).
      valor = ind.unidad === 'PORCENTAJE' ? (num / den) * 100 : num / den;
      valor = Math.round(valor * 100) / 100;
    } else {
      valor = Number(data.valor);
      if (!isFinite(valor)) return { ok: false, message: 'Indica el valor medido, o el numerador y el denominador.' };
    }

    var veredicto = evaluarIndicador_(valor, ind);

    var previa = leerFilasSeguro_(SHEETS.SGC_INDICADOR_LECTURAS).filter(function (l) {
      return esActivoSgc_(l) && l.indicador_id === ind.indicador_id && l.periodo === periodo;
    })[0];
    if (previa) {
      actualizarFilaPorId_(SHEETS.SGC_INDICADOR_LECTURAS, 'lectura_id', previa.lectura_id, { activa: false });
    }

    var ahora = new Date().toISOString();
    var lectura = {
      lectura_id: Utilities.getUuid(),
      // Vacio a proposito: esta lectura es de un INDICADOR, no de un
      // objetivo. Todo el tablero de objetivos cruza por objetivo_id, asi
      // que dejarlo vacio es lo que la mantiene invisible para el.
      objetivo_id: '',
      indicador_id: ind.indicador_id,
      anio: anio,
      periodo: periodo,
      valor: valor,
      numerador: num === null ? '' : num,
      denominador: den === null ? '' : den,
      cumple: veredicto === VEREDICTO_INDICADOR.CUMPLE,
      origen: veredicto,
      detalle: '',
      observaciones: String((data && data.observaciones) || '').trim(),
      registrado_por: (contexto && contexto.email) || '',
      fecha_registro: ahora,
      activa: true
    };
    agregarFila_(SHEETS.SGC_INDICADOR_LECTURAS, lectura);

    registrarLogSgc_('SGC_INDICADOR_MEDIDO',
      ind.codigo + ' ' + periodo + ' = ' + valor + ' (' + veredicto + ')', contexto);
    return {
      ok: true, lectura_id: lectura.lectura_id, valor: valor, veredicto: veredicto,
      message: ind.codigo + ' ' + periodo + ': ' + valor + ' — ' + etiquetaVeredicto_(veredicto) + '.'
    };
  },

  anularLectura: function (data, contexto) {
    var rol = rolSgc_(contexto);
    if (!gobiernaSgc_(contexto, rol)) {
      return { _forbidden: true, message: 'Solo el Encargado del SGC puede anular una medición.' };
    }
    var l = leerFilasSeguro_(SHEETS.SGC_INDICADOR_LECTURAS).filter(function (x) {
      return esActivoSgc_(x) && x.lectura_id === (data && data.lectura_id) && x.indicador_id;
    })[0];
    if (!l) return { ok: false, message: 'No se encontró la medición.' };
    actualizarFilaPorId_(SHEETS.SGC_INDICADOR_LECTURAS, 'lectura_id', l.lectura_id, { activa: false });
    registrarLogSgc_('SGC_INDICADOR_LECTURA_ANULADA', l.periodo + ' anulada', contexto);
    return { ok: true, message: 'Medición anulada.' };
  }
};

// --- evaluacion --------------------------------------------------------------

/**
 * CUMPLE / ALERTA / NO_CUMPLE. La tolerancia es opcional: sin ella solo hay
 * dos estados, que es exactamente como se comportaba el tablero de objetivos.
 */
function evaluarIndicador_(valor, indicador) {
  if (cumpleMeta_(valor, indicador)) return VEREDICTO_INDICADOR.CUMPLE;

  var tol = indicador.tolerancia_valor;
  if (tol === '' || tol === undefined || tol === null) return VEREDICTO_INDICADOR.NO_CUMPLE;
  var t = Number(tol);
  if (!isFinite(t)) return VEREDICTO_INDICADOR.NO_CUMPLE;

  // Se reusa el mismo operador contra el umbral de tolerancia: si la meta es
  // ">= 90" y la tolerancia 85, un 87 cumple contra 85 y queda en ALERTA.
  var contraTolerancia = cumpleMeta_(valor, { meta_valor: t, meta_operador: indicador.meta_operador });
  return contraTolerancia ? VEREDICTO_INDICADOR.ALERTA : VEREDICTO_INDICADOR.NO_CUMPLE;
}

function etiquetaVeredicto_(v) {
  if (v === VEREDICTO_INDICADOR.CUMPLE) return 'cumple';
  if (v === VEREDICTO_INDICADOR.ALERTA) return 'en alerta';
  return 'no cumple';
}

function etiquetaFrecuenciaIndicador_(clave) {
  var f = FRECUENCIAS_OBJETIVO.filter(function (x) { return x.clave === clave; })[0];
  return f ? f.etiqueta.toLowerCase() : String(clave || '').toLowerCase();
}

// --- helpers -----------------------------------------------------------------

function indicadoresActivos_() {
  return leerFilasSeguro_(SHEETS.SGC_INDICADORES).filter(function (i) {
    return esVerdaderoSgc_(i.activa);
  });
}

function siguienteCodigoIndicador_() {
  var max = 0;
  indicadoresActivos_().forEach(function (i) {
    var m = String(i.codigo || '').match(/^IND-(\d+)$/);
    if (!m) return;
    var n = parseInt(m[1], 10);
    if (isFinite(n) && n > max) max = n;
  });
  var sig = String(max + 1);
  return 'IND-' + (sig.length < 2 ? '0' + sig : sig);
}

function resumenIndicador_(i, lecturas, anio, procesoTexto, objetivoTexto) {
  var propias = lecturas
    .filter(function (l) { return l.indicador_id === i.indicador_id && Number(l.anio) === anio; })
    .sort(function (a, b) { return String(a.periodo).localeCompare(String(b.periodo)); });

  var ultima = propias.length ? propias[propias.length - 1] : null;
  var periodos = periodosDelAnio_(i.frecuencia, anio);
  var cerrados = periodos.filter(function (p) { return p.cerrado; });
  var medidos = cerrados.filter(function (p) {
    return propias.some(function (l) { return l.periodo === p.clave; });
  });

  return {
    indicador_id: i.indicador_id,
    codigo: i.codigo,
    nombre: i.nombre,
    descripcion: i.descripcion || '',
    proceso_id: i.proceso_id || '',
    proceso: procesoTexto,
    objetivo_id: i.objetivo_id || '',
    objetivo: objetivoTexto,
    area: i.area || '',
    formula: i.formula || '',
    fuente: i.fuente || '',
    unidad: i.unidad || '',
    meta_operador: i.meta_operador,
    meta_valor: Number(i.meta_valor),
    meta_texto: i.meta_texto || '',
    tolerancia_valor: (i.tolerancia_valor === '' || i.tolerancia_valor === undefined || i.tolerancia_valor === null)
      ? null : Number(i.tolerancia_valor),
    frecuencia: i.frecuencia,
    responsable_email: i.responsable_email || '',
    estado: i.estado || 'ACTIVO',
    observaciones: i.observaciones || '',
    ultima_lectura: ultima ? {
      lectura_id: ultima.lectura_id,
      periodo: ultima.periodo,
      valor: Number(ultima.valor),
      numerador: ultima.numerador === '' ? null : Number(ultima.numerador),
      denominador: ultima.denominador === '' ? null : Number(ultima.denominador),
      veredicto: ultima.origen || (esVerdaderoSgc_(ultima.cumple) ? 'CUMPLE' : 'NO_CUMPLE'),
      fecha_registro: ultima.fecha_registro
    } : null,
    lecturas: propias.map(function (l) {
      return {
        lectura_id: l.lectura_id,
        periodo: l.periodo,
        valor: Number(l.valor),
        veredicto: l.origen || (esVerdaderoSgc_(l.cumple) ? 'CUMPLE' : 'NO_CUMPLE'),
        observaciones: l.observaciones || ''
      };
    }),
    periodos_cerrados: cerrados.length,
    periodos_medidos: medidos.length,
    lecturas_pendientes: cerrados.length - medidos.length
  };
}

function resumenTableroIndicadores_(filas, procesos) {
  var r = {
    total: filas.length, cumplen: 0, alerta: 0, no_cumplen: 0,
    sin_medir: 0, lecturas_pendientes: 0
  };
  filas.forEach(function (f) {
    if (!f.ultima_lectura) r.sin_medir++;
    else if (f.ultima_lectura.veredicto === 'CUMPLE') r.cumplen++;
    else if (f.ultima_lectura.veredicto === 'ALERTA') r.alerta++;
    else r.no_cumplen++;
    r.lecturas_pendientes += f.lecturas_pendientes;
  });

  // Cuantos procesos del MAPA no tienen ningun indicador. Es la medida de la
  // debilidad D1 del FODA ("no hay KPIs en todas las areas"), asi que el
  // numero significa algo concreto para esta organizacion.
  var conIndicador = {};
  filas.forEach(function (f) { if (f.proceso_id) conIndicador[f.proceso_id] = true; });
  var mapa = (procesos || []).filter(function (p) { return p.nivel === 'MAPA'; });
  r.procesos_mapa = mapa.length;
  r.procesos_sin_indicador = mapa.filter(function (p) { return !conIndicador[p.proceso_id]; }).length;
  return r;
}

function validarIndicador_(data) {
  var d = data || {};
  var nombre = String(d.nombre || '').trim();
  if (!nombre) return { error: 'Indica el nombre del indicador.' };

  var formula = String(d.formula || '').trim();
  if (!formula) {
    return { error: 'Escribe cómo se calcula: sin fórmula, dos personas pueden medir lo mismo de forma distinta.' };
  }

  if (!operadorValido_(d.meta_operador)) {
    return { error: 'Elige el operador de la meta (≥, >, ≤ o <).' };
  }
  var meta = Number(d.meta_valor);
  if (!isFinite(meta)) return { error: 'La meta tiene que ser un número.' };

  var frecuencia = String(d.frecuencia || '').trim().toUpperCase();
  if (!FRECUENCIAS_OBJETIVO.some(function (f) { return f.clave === frecuencia; })) {
    return { error: 'Elige la frecuencia de medición.' };
  }

  var tol = '';
  if (d.tolerancia_valor !== '' && d.tolerancia_valor !== undefined && d.tolerancia_valor !== null) {
    var t = Number(d.tolerancia_valor);
    if (!isFinite(t)) return { error: 'La tolerancia tiene que ser un número.' };
    // La tolerancia es un umbral MAS LAXO que la meta. Al reves no significa
    // nada: todo lo que pasara la tolerancia ya habria cumplido la meta.
    var masLaxa = (d.meta_operador === 'MAYOR_IGUAL' || d.meta_operador === 'MAYOR') ? t < meta : t > meta;
    if (!masLaxa) {
      return {
        error: 'La tolerancia tiene que ser más laxa que la meta (' +
          ((d.meta_operador === 'MAYOR_IGUAL' || d.meta_operador === 'MAYOR') ? 'menor' : 'mayor') +
          ' que ' + meta + '). Si no, nunca habría zona de alerta.'
      };
    }
    tol = t;
  }

  var estado = String(d.estado || 'ACTIVO').trim().toUpperCase();
  if (ESTADOS_INDICADOR.indexOf(estado) === -1) estado = 'ACTIVO';

  return {
    datos: {
      codigo: String(d.codigo || '').trim().toUpperCase(),
      nombre: nombre,
      descripcion: String(d.descripcion || '').trim(),
      proceso_id: String(d.proceso_id || '').trim(),
      objetivo_id: String(d.objetivo_id || '').trim(),
      area: String(d.area || '').trim(),
      formula: formula,
      fuente: String(d.fuente || '').trim(),
      unidad: String(d.unidad || '').trim(),
      meta_operador: d.meta_operador,
      meta_valor: meta,
      meta_texto: String(d.meta_texto || '').trim(),
      tolerancia_valor: tol,
      frecuencia: frecuencia,
      responsable_email: String(d.responsable_email || '').trim(),
      estado: estado,
      observaciones: String(d.observaciones || '').trim()
    }
  };
}
