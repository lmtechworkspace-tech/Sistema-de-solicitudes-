'use strict';

/**
 * alcanceSgc.js — puerto de backend/backoffice/Alcance.gs (SGC ISO 9001,
 * v11.0 Fase 1, §4.3). Antes de esta fase la matriz de cobertura preguntaba
 * "¿hay evidencia de 4.3?" mirando documentos etiquetados a mano, y no tenía
 * forma de saber que la organización excluyó 7.1.5.2 y 8.5.1 f) -- dos
 * preguntas sin respuesta en pantalla para el auditor.
 *
 * Cuatro decisiones (idénticas al .gs):
 * 1) NADA se siembra solo. La propuesta del DOC-01 (`ALCANCE_PROPUESTO_DOC01`)
 *    se ofrece prellenada y no se guarda hasta que una persona la confirma.
 * 2) La exclusión se guarda con la granularidad del manual, incluida la
 *    SUB-cláusula ('7.1.5.2'); se deriva `clausula_padre` al guardar, que es
 *    por donde la matriz la encuentra.
 * 3) Excluir una SUB-cláusula NO cambia el estado de la cláusula padre. Solo
 *    una exclusión de la cláusula COMPLETA ('8.3') la marca NO_APLICA.
 * 4) La justificación es obligatoria: sin ella no es una exclusión válida
 *    para §4.3, es una cláusula incumplida con otro nombre.
 */

const crypto = require('node:crypto');
const { leerFilas_, agregarFila_, actualizarFilaPorId_ } = require('../db/sqliteRepo');
const { COLUMNAS } = require('../db/schema');
const Calidad = require('./calidadSgc');
const { CLAUSULAS_ISO9001 } = require('./sgcCatalogo');

// Edición de la norma con la que trabaja el sistema hoy. Vive acá y no
// desperdigada porque el alcance es quien DECLARA contra qué edición rige.
const NORMA_SGC_POR_DEFECTO = { codigo: 'ISO 9001', version: '2015' };
const VERSIONES_NORMA_SOPORTADAS = ['2015'];

// La declaración tal como está en el DOC-01 "Manual de calidad". Se ofrece
// PRELLENADA y no se guarda sola. El texto se transcribe del documento, no
// se redacta acá.
const ALCANCE_PROPUESTO_DOC01 = {
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
      clausula: '7.1.5.2', titulo: 'Trazabilidad de las mediciones',
      justificacion: 'La organización no realiza mediciones que requieran equipos de ' +
        'seguimiento y medición trazables a patrones nacionales o internacionales: los ' +
        'servicios prestados son de asesoría documental y administrativa.'
    },
    {
      clausula: '8.5.1 f', titulo: 'Validación y revalidación periódica de procesos cuyas salidas no pueden verificarse',
      justificacion: 'Las salidas de los servicios prestados son verificables mediante ' +
        'actividades de seguimiento y medición posteriores (revisión y liberación por la ' +
        'jefatura de cada área), por lo que no aplica la validación de procesos especiales.'
    }
  ],
  // Lo que el análisis de Fase 0 dejó abierto y NO se resuelve por cuenta
  // del sistema: se muestra junto al formulario para que quien confirme el
  // alcance lo decida a la vista.
  advertencias: [
    'El DOC-01 declara cuatro áreas. El DOC-03 (mapa de procesos) además lista ' +
      'Administración y Facturación y Cobranzas como procesos de apoyo. Confirma si ' +
      'forman parte del alcance declarado o son soporte interno.'
  ]
};

const ESTADOS_ALCANCE = { VIGENTE: 'VIGENTE', REEMPLAZADO: 'REEMPLAZADO' };

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

// --- helpers -----------------------------------------------------------------
function alcanceVigente_(db) {
  const filas = leerSeguro_(db, 'SGC_ALCANCE').filter((a) => esVerdadero_(a.activa) && a.estado === ESTADOS_ALCANCE.VIGENTE);
  // Si por cualquier razón hubiera más de uno vigente, gana el último creado.
  filas.sort((a, b) => String(a.fecha_creacion || '').localeCompare(String(b.fecha_creacion || '')));
  return filas.length ? filas[filas.length - 1] : null;
}
function exclusionesDe_(db, alcanceId) {
  if (!alcanceId) return [];
  return leerSeguro_(db, 'SGC_EXCLUSIONES').filter((e) => esVerdadero_(e.activa) && e.alcance_id === alcanceId);
}
/**
 * '7.1.5.2' → '7.1' · '8.5.1 f' → '8.5' · '8.3' → '8.3'
 * Los dos primeros segmentos numéricos, que es la granularidad del catálogo.
 */
function clausulaPadreIso_(clausula) {
  const limpio = String(clausula || '').trim();
  const m = limpio.match(/^(\d+)\.(\d+)/);
  if (!m) return '';
  return m[1] + '.' + m[2];
}
function existeClausulaIso_(codigo) { return CLAUSULAS_ISO9001.some((c) => c.codigo === codigo); }
function siguienteVersionAlcance_(actual) {
  let n = parseInt(String(actual || '0').replace(/\D/g, ''), 10);
  if (!isFinite(n) || n < 1) n = 1;
  const sig = String(n + 1);
  return sig.length < 2 ? '0' + sig : sig;
}
function listaDesdeJson_(valor) {
  if (Array.isArray(valor)) return valor;
  const texto = String(valor == null ? '' : valor).trim();
  if (!texto) return [];
  try {
    const parsed = JSON.parse(texto);
    return Array.isArray(parsed) ? parsed : [];
  } catch (err) {
    // Tolerancia deliberada: si alguien editó la celda a mano y escribió
    // "RRHH, Contabilidad", se lee igual en vez de perder el dato.
    return texto.split(',').map((s) => s.trim()).filter(Boolean);
  }
}
function formatearAlcance_(fila) {
  return {
    alcance_id: fila.alcance_id, version: fila.version, estado: fila.estado,
    razon_social: fila.razon_social, nombre_fantasia: fila.nombre_fantasia, rut: fila.rut,
    declaracion: fila.declaracion, areas: listaDesdeJson_(fila.areas), ubicaciones: listaDesdeJson_(fila.ubicaciones),
    norma_codigo: fila.norma_codigo, norma_version: fila.norma_version,
    documento_id: fila.documento_id || '', observaciones: fila.observaciones || '',
    vigente_desde: fila.vigente_desde || '', creado_por: fila.creado_por || '', fecha_creacion: fila.fecha_creacion || ''
  };
}
function formatearExclusion_(fila) {
  const padre = fila.clausula_padre || clausulaPadreIso_(fila.clausula);
  return {
    exclusion_id: fila.exclusion_id, clausula: fila.clausula, clausula_padre: padre,
    titulo: fila.titulo || '', justificacion: fila.justificacion || '',
    total: String(fila.clausula).trim() === padre, creado_por: fila.creado_por || '', fecha_creacion: fila.fecha_creacion || ''
  };
}
function historialAlcance_(db) {
  return leerSeguro_(db, 'SGC_ALCANCE')
    .filter((a) => esVerdadero_(a.activa) && a.estado === ESTADOS_ALCANCE.REEMPLAZADO)
    .map((a) => ({ alcance_id: a.alcance_id, version: a.version, declaracion: a.declaracion, vigente_desde: a.vigente_desde || '', observaciones: a.observaciones || '', fecha_creacion: a.fecha_creacion || '' }))
    .sort((x, y) => String(y.fecha_creacion).localeCompare(String(x.fecha_creacion)));
}
function validarAlcance_(data) {
  const d = data || {};
  const declaracion = String(d.declaracion || '').trim();
  if (!declaracion) return { error: 'La declaración de alcance es obligatoria: es lo que §4.3 pide mantener documentado.' };
  const razon = String(d.razon_social || '').trim();
  if (!razon) return { error: 'Indica la razón social: es el nombre con el que se emite el certificado.' };

  const areas = Array.isArray(d.areas) ? d.areas.map((s) => String(s).trim()).filter(Boolean) : listaDesdeJson_(d.areas);
  if (!areas.length) return { error: 'Indica al menos un área dentro del alcance.' };

  const version = String(d.norma_version || NORMA_SGC_POR_DEFECTO.version).trim();
  if (VERSIONES_NORMA_SOPORTADAS.indexOf(version) === -1) return { error: 'El sistema todavía no evalúa la edición ' + version + ' de la norma.' };

  return {
    datos: {
      razon_social: razon, nombre_fantasia: String(d.nombre_fantasia || '').trim(), rut: String(d.rut || '').trim(),
      declaracion, areas,
      ubicaciones: Array.isArray(d.ubicaciones) ? d.ubicaciones.map((s) => String(s).trim()).filter(Boolean) : listaDesdeJson_(d.ubicaciones),
      norma_codigo: String(d.norma_codigo || NORMA_SGC_POR_DEFECTO.codigo).trim(), norma_version: version,
      documento_id: String(d.documento_id || '').trim(), observaciones: String(d.observaciones || '').trim(),
      vigente_desde: String(d.vigente_desde || '').trim()
    }
  };
}

/**
 * Las exclusiones vigentes agrupadas por cláusula PADRE, que es como las
 * consulta la matriz de cobertura. Se expone aparte para que la matriz no
 * tenga que saber cómo están guardadas.
 */
function exclusionesVigentesPorClausula_(db) {
  const vigente = alcanceVigente_(db);
  const mapa = {};
  if (!vigente) return mapa;
  exclusionesDe_(db, vigente.alcance_id).forEach((e) => {
    const padre = e.clausula_padre || clausulaPadreIso_(e.clausula);
    if (!padre) return;
    if (!mapa[padre]) mapa[padre] = [];
    mapa[padre].push({
      clausula: e.clausula, titulo: e.titulo || '', justificacion: e.justificacion || '',
      // Una exclusion de la clausula COMPLETA es la unica que puede marcarla
      // NO_APLICA. Excluir 7.1.5.2 no saca del alcance a 7.1 entera.
      total: String(e.clausula).trim() === padre
    });
  });
  return mapa;
}

// ===========================================================================
// API publica
// ===========================================================================

/**
 * El alcance vigente con sus exclusiones. Lectura abierta a cualquiera que
 * entre a Calidad: §4.3 pide que el alcance esté DISPONIBLE. Editarlo sigue
 * siendo del Encargado.
 */
function obtener(db, data, contexto) {
  const gobierna = Calidad.gobiernaSgc_(db, contexto);
  const vigente = alcanceVigente_(db);
  const exclusiones = vigente ? exclusionesDe_(db, vigente.alcance_id) : [];

  return {
    puede_gestionar: gobierna, norma_por_defecto: NORMA_SGC_POR_DEFECTO, versiones_norma: VERSIONES_NORMA_SOPORTADAS,
    clausulas_catalogo: CLAUSULAS_ISO9001, alcance: vigente ? formatearAlcance_(vigente) : null,
    exclusiones: exclusiones.map(formatearExclusion_), historial: historialAlcance_(db),
    // Sin alcance declarado se devuelve la propuesta del DOC-01 para que el
    // formulario venga lleno. Es una SUGERENCIA: no está en la planilla.
    propuesta: vigente ? null : ALCANCE_PROPUESTO_DOC01
  };
}

/**
 * Crea el alcance si no existe, o corrige el vigente. Corregir en el mismo
 * registro es lo correcto para un error de tipeo; cuando el alcance cambia
 * de verdad se usa `nuevaVersion`, que conserva el anterior.
 */
function guardar(db, data, contexto) {
  if (!Calidad.gobiernaSgc_(db, contexto)) return { _forbidden: true, message: 'Solo el Encargado del SGC puede declarar el alcance.' };

  const val = validarAlcance_(data);
  if (val.error) return { ok: false, message: val.error };

  const vigente = alcanceVigente_(db);
  const ahora = new Date().toISOString();

  if (!vigente) {
    const alcanceId = uuid_();
    agregarFila_(db, 'SGC_ALCANCE', {
      alcance_id: alcanceId, version: '01', estado: ESTADOS_ALCANCE.VIGENTE,
      razon_social: val.datos.razon_social, nombre_fantasia: val.datos.nombre_fantasia, rut: val.datos.rut,
      declaracion: val.datos.declaracion, areas: JSON.stringify(val.datos.areas), ubicaciones: JSON.stringify(val.datos.ubicaciones),
      norma_codigo: val.datos.norma_codigo, norma_version: val.datos.norma_version,
      documento_id: val.datos.documento_id, observaciones: val.datos.observaciones,
      vigente_desde: val.datos.vigente_desde || ahora.slice(0, 10), reemplazado_por: '',
      creado_por: (contexto && contexto.email) || '', fecha_creacion: ahora, activa: true
    });
    registrarLogSgc_(db, 'SGC_ALCANCE_DECLARADO', 'Alcance del SGC declarado (v01)', contexto);
    return { ok: true, alcance_id: alcanceId, message: 'Alcance declarado.' };
  }

  actualizarFilaPorId_(db, 'SGC_ALCANCE', 'alcance_id', vigente.alcance_id, {
    razon_social: val.datos.razon_social, nombre_fantasia: val.datos.nombre_fantasia, rut: val.datos.rut,
    declaracion: val.datos.declaracion, areas: JSON.stringify(val.datos.areas), ubicaciones: JSON.stringify(val.datos.ubicaciones),
    norma_codigo: val.datos.norma_codigo, norma_version: val.datos.norma_version,
    documento_id: val.datos.documento_id, observaciones: val.datos.observaciones,
    vigente_desde: val.datos.vigente_desde || vigente.vigente_desde
  });
  registrarLogSgc_(db, 'SGC_ALCANCE_EDITADO', 'Alcance del SGC corregido (v' + vigente.version + ')', contexto);
  return { ok: true, alcance_id: vigente.alcance_id, message: 'Alcance actualizado.' };
}

/**
 * Publica una versión nueva: la anterior pasa a REEMPLAZADO y se conserva.
 * Las exclusiones se copian a la versión nueva -- si no, publicar una
 * versión dejaría a la organización sin exclusiones declaradas de un día
 * para otro, que es justo el estado que §4.3 no admite.
 */
function nuevaVersion(db, data, contexto) {
  if (!Calidad.gobiernaSgc_(db, contexto)) return { _forbidden: true, message: 'Solo el Encargado del SGC puede publicar una versión del alcance.' };

  const vigente = alcanceVigente_(db);
  if (!vigente) return { ok: false, message: 'Todavía no hay un alcance declarado que reemplazar.' };

  const val = validarAlcance_(data);
  if (val.error) return { ok: false, message: val.error };
  if (!String(data.justificacion_cambio || '').trim()) {
    return { ok: false, message: 'Indica por qué cambia el alcance: queda como trazabilidad de la versión anterior.' };
  }

  const ahora = new Date().toISOString();
  const nuevoId = uuid_();
  const versionNueva = siguienteVersionAlcance_(vigente.version);

  agregarFila_(db, 'SGC_ALCANCE', {
    alcance_id: nuevoId, version: versionNueva, estado: ESTADOS_ALCANCE.VIGENTE,
    razon_social: val.datos.razon_social, nombre_fantasia: val.datos.nombre_fantasia, rut: val.datos.rut,
    declaracion: val.datos.declaracion, areas: JSON.stringify(val.datos.areas), ubicaciones: JSON.stringify(val.datos.ubicaciones),
    norma_codigo: val.datos.norma_codigo, norma_version: val.datos.norma_version,
    documento_id: val.datos.documento_id, observaciones: val.datos.observaciones,
    vigente_desde: val.datos.vigente_desde || ahora.slice(0, 10), reemplazado_por: '',
    creado_por: (contexto && contexto.email) || '', fecha_creacion: ahora, activa: true
  });

  // El motivo se guarda en la versión que SE REEMPLAZA, no en la nueva: es
  // la respuesta a "por qué dejó de regir esta".
  actualizarFilaPorId_(db, 'SGC_ALCANCE', 'alcance_id', vigente.alcance_id, {
    estado: ESTADOS_ALCANCE.REEMPLAZADO, reemplazado_por: nuevoId, observaciones: String(data.justificacion_cambio).trim()
  });

  // Las exclusiones viajan con la version nueva.
  exclusionesDe_(db, vigente.alcance_id).forEach((ex) => {
    agregarFila_(db, 'SGC_EXCLUSIONES', {
      exclusion_id: uuid_(), alcance_id: nuevoId, clausula: ex.clausula, clausula_padre: ex.clausula_padre,
      titulo: ex.titulo, justificacion: ex.justificacion, creado_por: (contexto && contexto.email) || '',
      fecha_creacion: ahora, activa: true
    });
  });

  registrarLogSgc_(db, 'SGC_ALCANCE_NUEVA_VERSION', 'Alcance v' + vigente.version + ' → v' + versionNueva, contexto);
  return { ok: true, alcance_id: nuevoId, version: versionNueva, message: 'Alcance v' + versionNueva + ' publicado.' };
}

/**
 * Declara o corrige una exclusión. La justificación es obligatoria: sin
 * ella no es una exclusión válida para §4.3.
 */
function guardarExclusion(db, data, contexto) {
  if (!Calidad.gobiernaSgc_(db, contexto)) return { _forbidden: true, message: 'Solo el Encargado del SGC puede declarar exclusiones.' };

  const vigente = alcanceVigente_(db);
  if (!vigente) return { ok: false, message: 'Declara primero el alcance: una exclusión es parte de él.' };

  const clausula = String(data.clausula || '').trim();
  const justificacion = String(data.justificacion || '').trim();
  if (!clausula) return { ok: false, message: 'Indica qué cláusula se excluye.' };
  if (!justificacion) return { ok: false, message: 'La justificación es obligatoria: §4.3 exige explicar por qué la cláusula no aplica.' };

  const padre = clausulaPadreIso_(clausula);
  if (!padre) return { ok: false, message: 'La cláusula "' + clausula + '" no tiene el formato esperado (por ejemplo 7.1.5.2 u 8.3).' };
  if (!existeClausulaIso_(padre)) return { ok: false, message: 'La cláusula "' + clausula + '" no corresponde a ningún capítulo auditable de la norma.' };

  const ahora = new Date().toISOString();
  const existentes = exclusionesDe_(db, vigente.alcance_id);

  if (data.exclusion_id) {
    const actual = existentes.find((e) => e.exclusion_id === data.exclusion_id);
    if (!actual) return { ok: false, message: 'No se encontró la exclusión que quieres corregir.' };
    actualizarFilaPorId_(db, 'SGC_EXCLUSIONES', 'exclusion_id', actual.exclusion_id, { clausula, clausula_padre: padre, titulo: String(data.titulo || '').trim(), justificacion });
    registrarLogSgc_(db, 'SGC_EXCLUSION_EDITADA', 'Exclusión ' + clausula + ' corregida', contexto);
    return { ok: true, exclusion_id: actual.exclusion_id, message: 'Exclusión actualizada.' };
  }

  const repetida = existentes.find((e) => e.clausula === clausula);
  if (repetida) return { ok: false, message: 'La cláusula ' + clausula + ' ya está declarada como exclusión.' };

  const id = uuid_();
  agregarFila_(db, 'SGC_EXCLUSIONES', {
    exclusion_id: id, alcance_id: vigente.alcance_id, clausula, clausula_padre: padre,
    titulo: String(data.titulo || '').trim(), justificacion, creado_por: (contexto && contexto.email) || '',
    fecha_creacion: ahora, activa: true
  });
  registrarLogSgc_(db, 'SGC_EXCLUSION_DECLARADA', 'Exclusión ' + clausula + ' declarada', contexto);
  return { ok: true, exclusion_id: id, message: 'Exclusión declarada.' };
}

function anularExclusion(db, data, contexto) {
  if (!Calidad.gobiernaSgc_(db, contexto)) return { _forbidden: true, message: 'Solo el Encargado del SGC puede retirar una exclusión.' };
  const vigente = alcanceVigente_(db);
  if (!vigente) return { ok: false, message: 'No hay alcance declarado.' };

  const ex = exclusionesDe_(db, vigente.alcance_id).find((e) => e.exclusion_id === data.exclusion_id);
  if (!ex) return { ok: false, message: 'No se encontró la exclusión.' };

  actualizarFilaPorId_(db, 'SGC_EXCLUSIONES', 'exclusion_id', ex.exclusion_id, { activa: false });
  registrarLogSgc_(db, 'SGC_EXCLUSION_RETIRADA', 'Exclusión ' + ex.clausula + ' retirada: la cláusula vuelve a aplicar', contexto);
  return { ok: true, message: 'Exclusión retirada. La cláusula vuelve a considerarse aplicable.' };
}

module.exports = {
  obtener, guardar, nuevaVersion, guardarExclusion, anularExclusion,
  // Consumidos por matrizCoberturaSgc.js (Fase 6b, evaluador de §4.3 y
  // exclusiones por cláusula).
  alcanceVigente_, exclusionesVigentesPorClausula_, exclusionesDe_, listaDesdeJson_, clausulaPadreIso_
};
