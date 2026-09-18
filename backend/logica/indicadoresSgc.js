'use strict';

/**
 * indicadoresSgc.js — puerto de backend/backoffice/Indicadores.gs (SGC ISO
 * 9001, v11.0 Fase 6, §9.1.1: indicadores de proceso).
 *
 * Los SGC_OBJETIVOS son los seis del DOC-07: corporativos, anuales, fijados
 * por la Dirección. Un indicador de PROCESO es otra cosa -- mide cómo va un
 * proceso concreto, lo define su responsable y no se reabre cada enero.
 *
 * Esta fase no es un capricho de completitud: la debilidad D1 del FODA de
 * la empresa dice, textual, "No se han establecido, definido e
 * implementado indicadores de gestión (KPI) en todas las áreas", y la
 * acción del riesgo R1 es "Definir e implementar KPIs por área alineados a
 * los objetivos de calidad del SGC". Esto es la herramienta para hacerlo.
 *
 * Tres decisiones (idénticas al .gs):
 * 1) Hoja aparte, no generalizar SGC_OBJETIVOS. Los objetivos se guardan
 *    POR AÑO a propósito; un indicador de proceso vive mientras viva el
 *    proceso.
 * 2) Las LECTURAS se comparten: SGC_INDICADOR_LECTURAS ganó un
 *    `indicador_id` aditivo. Todo lo que ya existía cruza por
 *    `objetivo_id`, así que estas filas son invisibles para el tablero de
 *    objetivos.
 * 3) Hay un escalón intermedio: CUMPLE / ALERTA / NO_CUMPLE. Sin tolerancia
 *    solo hay verde y rojo.
 *
 * Reutiliza de objetivosSgc.js los catálogos (frecuencias, operadores,
 * unidades, fuentes), el calendario de períodos y `cumpleMeta_`. No se
 * copian: si la empresa cambia una frecuencia, tiene que cambiar en un
 * solo lugar.
 */

const crypto = require('node:crypto');
const { leerFilas_, agregarFila_, actualizarFilaPorId_ } = require('../db/sqliteRepo');
const { COLUMNAS } = require('../db/schema');
const Calidad = require('./calidadSgc');
const Procesos = require('./procesosSgc');
const {
  FRECUENCIAS_OBJETIVO, OPERADORES_META, UNIDADES_INDICADOR, FUENTES_INDICADOR,
  periodosDelAnio_, cumpleMeta_, operadorValido_
} = require('./objetivosSgc');

const ESTADOS_INDICADOR = ['ACTIVO', 'SUSPENDIDO'];
// Veredicto de una lectura contra su meta y su tolerancia.
const VEREDICTO_INDICADOR = { CUMPLE: 'CUMPLE', ALERTA: 'ALERTA', NO_CUMPLE: 'NO_CUMPLE' };

function uuid_() { return crypto.randomUUID(); }
function esVerdadero_(v) { return v === true || v === 'TRUE' || v === 1; }
function leer_(db, hoja) { return leerFilas_(db, hoja, COLUMNAS[hoja]); }
function leerSeguro_(db, hoja) { try { return leer_(db, hoja); } catch (err) { return []; } }
function registrarLogSgc_(db, accion, detalle, contexto) {
  try {
    agregarFila_(db, 'LOG_SISTEMA', {
      log_id: uuid_(), timestamp: new Date().toISOString(), contexto: accion,
      mensaje: ((contexto && contexto.email) || '') + ' → ' + detalle, ref: 'SGC'
    });
  } catch (err) { /* trazabilidad, no el flujo principal */ }
}

// --- evaluación ----------------------------------------------------------

/**
 * CUMPLE / ALERTA / NO_CUMPLE. La tolerancia es opcional: sin ella solo hay
 * dos estados, que es exactamente como se comportaba el tablero de
 * objetivos.
 */
function evaluarIndicador_(valor, indicador) {
  if (cumpleMeta_(valor, indicador)) return VEREDICTO_INDICADOR.CUMPLE;

  const tol = indicador.tolerancia_valor;
  if (tol === '' || tol === undefined || tol === null) return VEREDICTO_INDICADOR.NO_CUMPLE;
  const t = Number(tol);
  if (!isFinite(t)) return VEREDICTO_INDICADOR.NO_CUMPLE;

  // Se reusa el mismo operador contra el umbral de tolerancia: si la meta
  // es ">= 90" y la tolerancia 85, un 87 cumple contra 85 y queda en ALERTA.
  const contraTolerancia = cumpleMeta_(valor, { meta_valor: t, meta_operador: indicador.meta_operador });
  return contraTolerancia ? VEREDICTO_INDICADOR.ALERTA : VEREDICTO_INDICADOR.NO_CUMPLE;
}

function etiquetaVeredicto_(v) {
  if (v === VEREDICTO_INDICADOR.CUMPLE) return 'cumple';
  if (v === VEREDICTO_INDICADOR.ALERTA) return 'en alerta';
  return 'no cumple';
}

function etiquetaFrecuenciaIndicador_(clave) {
  const f = FRECUENCIAS_OBJETIVO.find((x) => x.clave === clave);
  return f ? f.etiqueta.toLowerCase() : String(clave || '').toLowerCase();
}

// --- helpers ---------------------------------------------------------------

function indicadoresActivos_(db) {
  return leerSeguro_(db, 'SGC_INDICADORES').filter((i) => esVerdadero_(i.activa));
}

function siguienteCodigoIndicador_(db) {
  let max = 0;
  indicadoresActivos_(db).forEach((i) => {
    const m = String(i.codigo || '').match(/^IND-(\d+)$/);
    if (!m) return;
    const n = parseInt(m[1], 10);
    if (isFinite(n) && n > max) max = n;
  });
  const sig = String(max + 1);
  return 'IND-' + (sig.length < 2 ? '0' + sig : sig);
}

function resumenIndicador_(i, lecturas, anio, procesoTexto, objetivoTexto) {
  const propias = lecturas
    .filter((l) => l.indicador_id === i.indicador_id && Number(l.anio) === anio)
    .sort((a, b) => String(a.periodo).localeCompare(String(b.periodo)));

  const ultima = propias.length ? propias[propias.length - 1] : null;
  const periodos = periodosDelAnio_(i.frecuencia, anio);
  const cerrados = periodos.filter((p) => p.cerrado);
  const medidos = cerrados.filter((p) => propias.some((l) => l.periodo === p.clave));

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
      veredicto: ultima.origen || (esVerdadero_(ultima.cumple) ? 'CUMPLE' : 'NO_CUMPLE'),
      fecha_registro: ultima.fecha_registro
    } : null,
    lecturas: propias.map((l) => ({
      lectura_id: l.lectura_id,
      periodo: l.periodo,
      valor: Number(l.valor),
      veredicto: l.origen || (esVerdadero_(l.cumple) ? 'CUMPLE' : 'NO_CUMPLE'),
      observaciones: l.observaciones || ''
    })),
    periodos_cerrados: cerrados.length,
    periodos_medidos: medidos.length,
    lecturas_pendientes: cerrados.length - medidos.length
  };
}

function resumenTableroIndicadores_(filas, procesos) {
  const r = { total: filas.length, cumplen: 0, alerta: 0, no_cumplen: 0, sin_medir: 0, lecturas_pendientes: 0 };
  filas.forEach((f) => {
    if (!f.ultima_lectura) r.sin_medir++;
    else if (f.ultima_lectura.veredicto === 'CUMPLE') r.cumplen++;
    else if (f.ultima_lectura.veredicto === 'ALERTA') r.alerta++;
    else r.no_cumplen++;
    r.lecturas_pendientes += f.lecturas_pendientes;
  });

  // Cuántos procesos del MAPA no tienen ningún indicador. Es la medida de
  // la debilidad D1 del FODA ("no hay KPIs en todas las áreas"), así que el
  // número significa algo concreto para esta organización.
  const conIndicador = {};
  filas.forEach((f) => { if (f.proceso_id) conIndicador[f.proceso_id] = true; });
  const mapa = (procesos || []).filter((p) => p.nivel === 'MAPA');
  r.procesos_mapa = mapa.length;
  r.procesos_sin_indicador = mapa.filter((p) => !conIndicador[p.proceso_id]).length;
  return r;
}

function validarIndicador_(data) {
  const d = data || {};
  const nombre = String(d.nombre || '').trim();
  if (!nombre) return { error: 'Indica el nombre del indicador.' };

  const formula = String(d.formula || '').trim();
  if (!formula) {
    return { error: 'Escribe cómo se calcula: sin fórmula, dos personas pueden medir lo mismo de forma distinta.' };
  }

  if (!operadorValido_(d.meta_operador)) {
    return { error: 'Elige el operador de la meta (≥, >, ≤ o <).' };
  }
  const meta = Number(d.meta_valor);
  if (!isFinite(meta)) return { error: 'La meta tiene que ser un número.' };

  const frecuencia = String(d.frecuencia || '').trim().toUpperCase();
  if (!FRECUENCIAS_OBJETIVO.some((f) => f.clave === frecuencia)) {
    return { error: 'Elige la frecuencia de medición.' };
  }

  let tol = '';
  if (d.tolerancia_valor !== '' && d.tolerancia_valor !== undefined && d.tolerancia_valor !== null) {
    const t = Number(d.tolerancia_valor);
    if (!isFinite(t)) return { error: 'La tolerancia tiene que ser un número.' };
    // La tolerancia es un umbral MÁS LAXO que la meta. Al revés no significa
    // nada: todo lo que pasara la tolerancia ya habría cumplido la meta.
    const masLaxa = (d.meta_operador === 'MAYOR_IGUAL' || d.meta_operador === 'MAYOR') ? t < meta : t > meta;
    if (!masLaxa) {
      return {
        error: 'La tolerancia tiene que ser más laxa que la meta (' +
          ((d.meta_operador === 'MAYOR_IGUAL' || d.meta_operador === 'MAYOR') ? 'menor' : 'mayor') +
          ' que ' + meta + '). Si no, nunca habría zona de alerta.'
      };
    }
    tol = t;
  }

  let estado = String(d.estado || 'ACTIVO').trim().toUpperCase();
  if (ESTADOS_INDICADOR.indexOf(estado) === -1) estado = 'ACTIVO';

  return {
    datos: {
      codigo: String(d.codigo || '').trim().toUpperCase(),
      nombre,
      descripcion: String(d.descripcion || '').trim(),
      proceso_id: String(d.proceso_id || '').trim(),
      objetivo_id: String(d.objetivo_id || '').trim(),
      area: String(d.area || '').trim(),
      formula,
      fuente: String(d.fuente || '').trim(),
      unidad: String(d.unidad || '').trim(),
      meta_operador: d.meta_operador,
      meta_valor: meta,
      meta_texto: String(d.meta_texto || '').trim(),
      tolerancia_valor: tol,
      frecuencia,
      responsable_email: String(d.responsable_email || '').trim(),
      estado,
      observaciones: String(d.observaciones || '').trim()
    }
  };
}

// --- acciones ----------------------------------------------------------------

function listar(db, data, contexto) {
  const rol = Calidad.rolSgc_(db, contexto);
  const gobierna = Calidad.gobiernaSgc_(db, contexto);
  if (!(gobierna || Calidad.veTodoSgc_(db, contexto, rol, gobierna))) {
    return { _forbidden: true, message: 'No tienes acceso al tablero de indicadores.' };
  }

  const anio = Number(data && data.anio) || new Date().getFullYear();
  const indicadores = indicadoresActivos_(db);
  const lecturas = leerSeguro_(db, 'SGC_INDICADOR_LECTURAS').filter((l) => esVerdadero_(l.activa) && l.indicador_id);

  const procesos = Procesos.procesosActivos_(db);
  const nombreProceso = {};
  procesos.forEach((p) => { nombreProceso[p.proceso_id] = p.codigo + ' — ' + p.nombre; });

  const objetivos = leerSeguro_(db, 'SGC_OBJETIVOS').filter((o) => esVerdadero_(o.activa));
  const nombreObjetivo = {};
  objetivos.forEach((o) => { nombreObjetivo[o.objetivo_id] = 'OBJ-' + o.numero + ': ' + o.objetivo_general; });

  const filas = indicadores.map((i) => resumenIndicador_(i, lecturas, anio, nombreProceso[i.proceso_id] || '', nombreObjetivo[i.objetivo_id] || ''));

  return {
    anio,
    puede_gestionar: gobierna,
    catalogos: {
      frecuencias: FRECUENCIAS_OBJETIVO,
      operadores: OPERADORES_META,
      unidades: UNIDADES_INDICADOR,
      fuentes: FUENTES_INDICADOR
    },
    procesos: procesos.map((p) => ({ proceso_id: p.proceso_id, codigo: p.codigo, nombre: p.nombre, nivel: p.nivel })),
    objetivos: objetivos.map((o) => ({ objetivo_id: o.objetivo_id, numero: Number(o.numero), nombre: o.objetivo_general, anio: Number(o.anio) })),
    indicadores: filas,
    resumen: resumenTableroIndicadores_(filas, procesos)
  };
}

function guardar(db, data, contexto) {
  if (!Calidad.gobiernaSgc_(db, contexto)) {
    return { _forbidden: true, message: 'Solo el Encargado del SGC puede definir indicadores.' };
  }

  const val = validarIndicador_(data);
  if (val.error) return { ok: false, message: val.error };

  const ahora = new Date().toISOString();
  if (data.indicador_id) {
    const actual = indicadoresActivos_(db).filter((i) => i.indicador_id === data.indicador_id)[0];
    if (!actual) return { ok: false, message: 'No se encontró el indicador.' };
    actualizarFilaPorId_(db, 'SGC_INDICADORES', 'indicador_id', actual.indicador_id, val.datos);
    registrarLogSgc_(db, 'SGC_INDICADOR_EDITADO', actual.codigo + ' actualizado', contexto);
    return { ok: true, indicador_id: actual.indicador_id, message: 'Indicador actualizado.' };
  }

  const campos = val.datos;
  campos.indicador_id = uuid_();
  if (!campos.codigo) campos.codigo = siguienteCodigoIndicador_(db);
  campos.creado_por = (contexto && contexto.email) || '';
  campos.fecha_creacion = ahora;
  campos.activa = true;
  agregarFila_(db, 'SGC_INDICADORES', campos);
  registrarLogSgc_(db, 'SGC_INDICADOR_CREADO', campos.codigo + ' ' + campos.nombre, contexto);
  return { ok: true, indicador_id: campos.indicador_id, message: 'Indicador creado.' };
}

function anular(db, data, contexto) {
  if (!Calidad.gobiernaSgc_(db, contexto)) {
    return { _forbidden: true, message: 'Solo el Encargado del SGC puede quitar indicadores.' };
  }
  const i = indicadoresActivos_(db).filter((x) => x.indicador_id === data.indicador_id)[0];
  if (!i) return { ok: false, message: 'No se encontró el indicador.' };
  actualizarFilaPorId_(db, 'SGC_INDICADORES', 'indicador_id', i.indicador_id, { activa: false });
  registrarLogSgc_(db, 'SGC_INDICADOR_QUITADO', i.codigo + ' quitado', contexto);
  return { ok: true, message: 'Indicador quitado. Sus lecturas se conservan como historial.' };
}

/**
 * Registra la medición de un período. Mismo criterio que las lecturas de
 * objetivo: una por (indicador, período), y volver a medir REEMPLAZA
 * conservando la anterior como anulada.
 *
 * El veredicto se PERSISTE. La meta puede cambiar el año que viene y lo
 * que se midió este tiene que seguir diciendo lo que dijo entonces.
 */
function registrarLectura(db, data, contexto) {
  if (!Calidad.gobiernaSgc_(db, contexto)) {
    return { _forbidden: true, message: 'Solo el Encargado del SGC puede registrar mediciones.' };
  }

  const ind = indicadoresActivos_(db).filter((i) => i.indicador_id === (data && data.indicador_id))[0];
  if (!ind) return { ok: false, message: 'No se encontró el indicador.' };

  const periodo = String((data && data.periodo) || '').trim();
  if (!periodo) return { ok: false, message: 'Indica el período que estás midiendo.' };

  const anio = Number(String(periodo).slice(0, 4));
  if (!isFinite(anio)) return { ok: false, message: 'El período tiene que empezar por el año.' };
  // La clave de período tiene que corresponder a la frecuencia: un
  // indicador semestral no acepta una lectura de marzo.
  const validos = periodosDelAnio_(ind.frecuencia, anio).map((p) => p.clave);
  if (validos.indexOf(periodo) === -1) {
    return {
      ok: false,
      message: 'El período ' + periodo + ' no corresponde a la frecuencia ' +
        etiquetaFrecuenciaIndicador_(ind.frecuencia) + '. Válidos: ' + validos.join(', ') + '.'
    };
  }

  const num = data.numerador === '' || data.numerador === undefined || data.numerador === null ? null : Number(data.numerador);
  const den = data.denominador === '' || data.denominador === undefined || data.denominador === null ? null : Number(data.denominador);
  let valor;

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

  const veredicto = evaluarIndicador_(valor, ind);

  const previa = leerSeguro_(db, 'SGC_INDICADOR_LECTURAS').filter((l) =>
    esVerdadero_(l.activa) && l.indicador_id === ind.indicador_id && l.periodo === periodo)[0];
  if (previa) {
    actualizarFilaPorId_(db, 'SGC_INDICADOR_LECTURAS', 'lectura_id', previa.lectura_id, { activa: false });
  }

  const ahora = new Date().toISOString();
  const lectura = {
    lectura_id: uuid_(),
    // Vacío a propósito: esta lectura es de un INDICADOR, no de un
    // objetivo. Todo el tablero de objetivos cruza por objetivo_id, así
    // que dejarlo vacío es lo que la mantiene invisible para él.
    objetivo_id: '',
    indicador_id: ind.indicador_id,
    anio,
    periodo,
    valor,
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
  agregarFila_(db, 'SGC_INDICADOR_LECTURAS', lectura);

  registrarLogSgc_(db, 'SGC_INDICADOR_MEDIDO', ind.codigo + ' ' + periodo + ' = ' + valor + ' (' + veredicto + ')', contexto);
  return {
    ok: true, lectura_id: lectura.lectura_id, valor, veredicto,
    message: ind.codigo + ' ' + periodo + ': ' + valor + ' — ' + etiquetaVeredicto_(veredicto) + '.'
  };
}

function anularLectura(db, data, contexto) {
  if (!Calidad.gobiernaSgc_(db, contexto)) {
    return { _forbidden: true, message: 'Solo el Encargado del SGC puede anular una medición.' };
  }
  const l = leerSeguro_(db, 'SGC_INDICADOR_LECTURAS').filter((x) =>
    esVerdadero_(x.activa) && x.lectura_id === (data && data.lectura_id) && x.indicador_id)[0];
  if (!l) return { ok: false, message: 'No se encontró la medición.' };
  actualizarFilaPorId_(db, 'SGC_INDICADOR_LECTURAS', 'lectura_id', l.lectura_id, { activa: false });
  registrarLogSgc_(db, 'SGC_INDICADOR_LECTURA_ANULADA', l.periodo + ' anulada', contexto);
  return { ok: true, message: 'Medición anulada.' };
}

module.exports = {
  listar, guardar, anular, registrarLectura, anularLectura,
  // Consumida por matrizCoberturaSgc.js (evaluador de §9.1) en lugar del
  // stub que devolvía [] hasta este incremento, y por tests.
  indicadoresActivos_
};
