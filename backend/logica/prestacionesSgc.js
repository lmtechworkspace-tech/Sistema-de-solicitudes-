'use strict';

/**
 * prestacionesSgc.js — puerto de backend/backoffice/Prestaciones.gs (SGC
 * ISO 9001, v11.0 Fase 8: evidencia de servicios prestados, §8.1/§8.5/
 * §8.6/§8.7).
 *
 * La última fase del plan y la única con riesgo de escala. Por eso se dejó
 * para el final: con 50 clientes y 40 procesos de servicio, una matriz
 * completa cliente × proceso × mes serían 24.000 filas al año, casi todas
 * vacías, y cada consulta tendría que leerlas todas.
 *
 * Las tres decisiones que la hacen viable (idénticas al .gs):
 * 1) NO se pre-generan filas. Una fila existe cuando alguien registra que
 *    el servicio se prestó.
 * 2) Las consultas van SIEMPRE acotadas. `listar` sin filtro devuelve solo
 *    las últimas (TOPE_PRESTACIONES_SIN_FILTRO) y lo dice.
 * 3) El módulo MIDE su propio volumen y avisa cuando pasa el umbral.
 *
 * El cliente NO se duplica: sale de CAT_CLIENTES, que existe en SIGSO
 * desde la v1.0.
 */

const crypto = require('node:crypto');
const { leerFilas_, agregarFila_, actualizarFilaPorId_ } = require('../db/sqliteRepo');
const { COLUMNAS } = require('../db/schema');
const Calidad = require('./calidadSgc');
const Procesos = require('./procesosSgc');
const NoConformidades = require('./noConformidadesSgc');

const ESTADOS_PRESTACION = ['PRESTADO', 'LIBERADO', 'NO_CONFORME'];

// Cuántas filas devuelve una consulta sin filtro, y a partir de cuántas se
// avisa que conviene archivar el año anterior.
const TOPE_PRESTACIONES_SIN_FILTRO = 100;
const UMBRAL_VOLUMEN_PRESTACIONES = 5000;

function uuid_() { return crypto.randomUUID(); }
function esVerdadero_(v) { return v === true || v === 'TRUE' || v === 1; }
function esActivo_(fila) { return esVerdadero_(fila.activa); }
function leer_(db, hoja) { return leerFilas_(db, hoja, COLUMNAS[hoja]); }
function leerSeguro_(db, hoja) { try { return leer_(db, hoja); } catch (err) { return []; } }
function normalizarEmail_(email) { return String(email || '').trim().toLowerCase(); }
function registrarLogSgc_(db, accion, detalle, contexto) {
  try {
    agregarFila_(db, 'LOG_SISTEMA', {
      log_id: uuid_(), timestamp: new Date().toISOString(), contexto: accion,
      mensaje: ((contexto && contexto.email) || '') + ' → ' + detalle, ref: 'SGC'
    });
  } catch (err) { /* trazabilidad, no el flujo principal */ }
}

// --- helpers -----------------------------------------------------------------

function buscarPrestacion_(db, id) {
  if (!id) return null;
  return leerSeguro_(db, 'SGC_PRESTACIONES').filter((p) => esActivo_(p) && p.prestacion_id === id)[0] || null;
}

function formatearPrestacion_(p) {
  return {
    prestacion_id: p.prestacion_id,
    cliente_id: p.cliente_id,
    cliente_nombre: p.cliente_nombre || '',
    proceso_id: p.proceso_id,
    proceso_codigo: p.proceso_codigo || '',
    proceso_nombre: p.proceso_nombre || '',
    periodo: p.periodo || '',
    fecha_prestacion: p.fecha_prestacion || '',
    responsable_email: p.responsable_email || '',
    estado: p.estado || 'PRESTADO',
    evidencia: p.evidencia || '',
    liberado_por: p.liberado_por || '',
    fecha_liberacion: p.fecha_liberacion || '',
    // §8.6 pide trazabilidad a quien autoriza. Que sea la misma persona que
    // prestó el servicio no lo invalida, pero es una debilidad y se ve.
    liberada_por_el_mismo: !!p.liberado_por && normalizarEmail_(p.liberado_por) === normalizarEmail_(p.responsable_email),
    nc_id: p.nc_id || '',
    observaciones: p.observaciones || ''
  };
}

function resumenPrestaciones_(filas) {
  const r = { total: filas.length, prestado: 0, liberado: 0, no_conforme: 0, sin_evidencia: 0, autoliberadas: 0, nc_abiertas: 0 };
  filas.forEach((p) => {
    if (p.estado === 'LIBERADO') r.liberado++;
    else if (p.estado === 'NO_CONFORME') r.no_conforme++;
    else r.prestado++;
    if (!String(p.evidencia || '').trim()) r.sin_evidencia++;
    if (p.liberado_por && normalizarEmail_(p.liberado_por) === normalizarEmail_(p.responsable_email)) r.autoliberadas++;
    if (p.nc_id) r.nc_abiertas++;
  });
  return r;
}

/**
 * El módulo mide cuánto pesa y avisa antes de que duela. No se puede
 * evitar que una tabla crezca, pero sí se puede decir a tiempo que hay
 * que archivar el año anterior.
 */
function volumenPrestaciones_(todas) {
  const porAnio = {};
  todas.forEach((p) => {
    const a = String(p.periodo || p.fecha_prestacion || '').slice(0, 4);
    if (!a) return;
    porAnio[a] = (porAnio[a] || 0) + 1;
  });
  return {
    filas: todas.length,
    umbral: UMBRAL_VOLUMEN_PRESTACIONES,
    supera_umbral: todas.length >= UMBRAL_VOLUMEN_PRESTACIONES,
    por_anio: Object.keys(porAnio).sort().map((a) => ({ anio: a, total: porAnio[a] })),
    aviso: todas.length >= UMBRAL_VOLUMEN_PRESTACIONES
      ? 'El registro pasó las ' + UMBRAL_VOLUMEN_PRESTACIONES + ' filas. Conviene archivar los años ' +
        'cerrados en otra tabla: cada consulta lee la hoja completa, y a partir de aquí se empieza a notar.'
      : ''
  };
}

function validarPrestacion_(db, data) {
  const d = data || {};
  const clienteId = String(d.cliente_id || '').trim();
  if (!clienteId) return { error: 'Indica para qué cliente se prestó el servicio.' };
  const cliente = leerSeguro_(db, 'CAT_CLIENTES').filter((c) => c.cliente_id === clienteId)[0];
  if (!cliente) return { error: 'El cliente no está en el catálogo de SIGSO.' };

  const procesoId = String(d.proceso_id || '').trim();
  if (!procesoId) return { error: 'Indica qué proceso de servicio se prestó.' };
  const proceso = Procesos.procesosActivos_(db).filter((p) => p.proceso_id === procesoId)[0];
  if (!proceso) return { error: 'El proceso no existe. Carga primero los procesos de servicio (Fase 4).' };
  if (proceso.nivel !== 'SERVICIO') {
    return { error: 'Solo se registran prestaciones de procesos de SERVICIO, no de los del mapa.' };
  }

  const fecha = String(d.fecha_prestacion || '').trim().slice(0, 10);
  if (!fecha) return { error: 'Indica la fecha en que se prestó el servicio.' };

  const responsable = normalizarEmail_(d.responsable_email);
  if (!responsable) return { error: 'Indica quién prestó el servicio.' };

  return {
    datos: {
      cliente_id: clienteId,
      cliente_nombre: cliente.razon_social || '',
      proceso_id: procesoId,
      proceso_codigo: proceso.codigo || '',
      proceso_nombre: proceso.nombre || '',
      periodo: String(d.periodo || '').trim(),
      fecha_prestacion: fecha,
      responsable_email: responsable,
      evidencia: String(d.evidencia || '').trim(),
      observaciones: String(d.observaciones || '').trim()
    }
  };
}

// --- acciones ----------------------------------------------------------------

function listar(db, data, contexto) {
  const rol = Calidad.rolSgc_(db, contexto);
  const gobierna = Calidad.gobiernaSgc_(db, contexto);
  if (!(gobierna || Calidad.veTodoSgc_(db, contexto, rol, gobierna))) {
    return { _forbidden: true, message: 'No tienes acceso al registro de servicios prestados.' };
  }

  const filtros = data || {};
  const periodo = String(filtros.periodo || '').trim();
  const clienteId = String(filtros.cliente_id || '').trim();
  const procesoId = String(filtros.proceso_id || '').trim();
  const estado = String(filtros.estado || '').trim().toUpperCase();

  const todas = leerSeguro_(db, 'SGC_PRESTACIONES').filter(esActivo_);

  const filtradas = todas.filter((p) => {
    if (periodo && String(p.periodo || '') !== periodo) return false;
    if (clienteId && p.cliente_id !== clienteId) return false;
    if (procesoId && p.proceso_id !== procesoId) return false;
    if (estado && p.estado !== estado) return false;
    return true;
  });

  // Sin filtro no se devuelve todo: en un año de operación serían miles de
  // filas viajando al navegador para nada.
  const acotada = !periodo && !clienteId && !procesoId;
  let visibles = filtradas.slice().sort((a, b) => String(b.fecha_prestacion || '').localeCompare(String(a.fecha_prestacion || '')));
  if (acotada) visibles = visibles.slice(0, TOPE_PRESTACIONES_SIN_FILTRO);

  const procesos = Procesos.procesosActivos_(db).filter((p) => p.nivel === 'SERVICIO');
  const clientes = leerSeguro_(db, 'CAT_CLIENTES').filter((c) => esVerdadero_(c.activo));

  return {
    puede_gestionar: gobierna,
    // Lo que hay para elegir en los formularios: procesos de servicio de la
    // Fase 4 y clientes del catálogo que ya existía.
    procesos: procesos.map((p) => ({ proceso_id: p.proceso_id, codigo: p.codigo, nombre: p.nombre, area: p.area || '' })),
    clientes: clientes.map((c) => ({ cliente_id: c.cliente_id, nombre: c.razon_social, rut: c.rut || '' })),
    estados: ESTADOS_PRESTACION,
    filtros: { periodo, cliente_id: clienteId, proceso_id: procesoId, estado },
    acotada,
    tope: TOPE_PRESTACIONES_SIN_FILTRO,
    total_filtrado: filtradas.length,
    prestaciones: visibles.map(formatearPrestacion_),
    resumen: resumenPrestaciones_(filtradas),
    volumen: volumenPrestaciones_(todas)
  };
}

/**
 * Registra que un servicio se prestó. No exige período: los DOC-10 a 13
 * distinguen servicios mensuales de puntuales, y forzar un período a uno
 * puntual obligaría a inventarlo.
 */
function registrar(db, data, contexto) {
  if (!Calidad.gobiernaSgc_(db, contexto)) {
    return { _forbidden: true, message: 'Solo el Encargado del SGC puede registrar prestaciones.' };
  }

  const val = validarPrestacion_(db, data);
  if (val.error) return { ok: false, message: val.error };

  // Un proceso MENSUAL no puede tener dos prestaciones del mismo período
  // para el mismo cliente: sería contar dos veces el mismo servicio.
  if (val.datos.periodo) {
    const repetida = leerSeguro_(db, 'SGC_PRESTACIONES').filter((p) =>
      esActivo_(p) && p.cliente_id === val.datos.cliente_id &&
      p.proceso_id === val.datos.proceso_id && String(p.periodo || '') === val.datos.periodo)[0];
    if (repetida) {
      return {
        ok: false,
        message: 'Ya hay una prestación de ' + val.datos.proceso_codigo + ' para ese cliente en ' +
          val.datos.periodo + '. Edítala en vez de registrar otra.'
      };
    }
  }

  const ahora = new Date().toISOString();
  const campos = val.datos;
  campos.prestacion_id = uuid_();
  campos.estado = 'PRESTADO';
  campos.liberado_por = '';
  campos.fecha_liberacion = '';
  campos.nc_id = '';
  campos.creado_por = (contexto && contexto.email) || '';
  campos.fecha_creacion = ahora;
  campos.activa = true;
  agregarFila_(db, 'SGC_PRESTACIONES', campos);

  registrarLogSgc_(db, 'SGC_PRESTACION_REGISTRADA',
    campos.proceso_codigo + ' → ' + campos.cliente_nombre + (campos.periodo ? ' (' + campos.periodo + ')' : ''), contexto);
  return { ok: true, prestacion_id: campos.prestacion_id, message: 'Prestación registrada.' };
}

/**
 * §8.6: la liberación. La cláusula pide trazabilidad A LA PERSONA que
 * autoriza, así que se guarda quién y cuándo, no un simple "liberado".
 *
 * Si quien libera es quien prestó, se permite pero se ANOTA: el DOC-01
 * dice que libera la jefatura del área, y en un equipo de 14 personas eso
 * casi siempre es alguien distinto. No se bloquea porque ningún documento
 * lo prohíbe, pero la matriz de cobertura lo muestra.
 */
function liberar(db, data, contexto) {
  if (!Calidad.gobiernaSgc_(db, contexto)) {
    return { _forbidden: true, message: 'Solo el Encargado del SGC puede liberar un servicio.' };
  }
  const p = buscarPrestacion_(db, data && data.prestacion_id);
  if (!p) return { ok: false, message: 'No se encontró la prestación.' };
  if (p.estado === 'LIBERADO') return { ok: false, message: 'Esta prestación ya está liberada.' };
  if (p.estado === 'NO_CONFORME') {
    return { ok: false, message: 'Una salida no conforme no se libera: primero hay que tratarla (§8.7).' };
  }

  const quien = normalizarEmail_((data && data.liberado_por) || (contexto && contexto.email));
  if (!quien) return { ok: false, message: 'Indica quién autoriza la liberación.' };

  const hoy = new Date().toISOString().slice(0, 10);
  actualizarFilaPorId_(db, 'SGC_PRESTACIONES', 'prestacion_id', p.prestacion_id, {
    estado: 'LIBERADO',
    liberado_por: quien,
    fecha_liberacion: String((data && data.fecha_liberacion) || hoy).slice(0, 10)
  });
  registrarLogSgc_(db, 'SGC_PRESTACION_LIBERADA', p.proceso_codigo + ' → ' + p.cliente_nombre + ' liberada por ' + quien, contexto);

  const mismaPersona = quien === normalizarEmail_(p.responsable_email);
  return {
    ok: true,
    message: 'Servicio liberado.' + (mismaPersona
      ? ' Aviso: quien liberó es quien prestó el servicio; el DOC-01 dice que libera la jefatura del área.'
      : '')
  };
}

/**
 * §8.7: salida no conforme. Marcarla es el primer paso; el segundo,
 * opcional, es abrir la NC con el mismo eslabón que ya usan las quejas y
 * los hallazgos de auditoría.
 */
function marcarNoConforme(db, data, contexto) {
  if (!Calidad.gobiernaSgc_(db, contexto)) {
    return { _forbidden: true, message: 'Solo el Encargado del SGC puede marcar una salida no conforme.' };
  }
  const p = buscarPrestacion_(db, data && data.prestacion_id);
  if (!p) return { ok: false, message: 'No se encontró la prestación.' };

  const motivo = String((data && data.observaciones) || '').trim();
  if (!motivo) {
    return { ok: false, message: 'Describe en qué no conformó el servicio: sin eso no hay nada que tratar.' };
  }

  actualizarFilaPorId_(db, 'SGC_PRESTACIONES', 'prestacion_id', p.prestacion_id, {
    estado: 'NO_CONFORME',
    observaciones: motivo,
    // Una salida no conforme deja de estar liberada: §8.7 pide que no se
    // entregue hasta corregirla.
    liberado_por: '',
    fecha_liberacion: ''
  });
  registrarLogSgc_(db, 'SGC_SALIDA_NO_CONFORME', p.proceso_codigo + ' → ' + p.cliente_nombre + ': ' + motivo.slice(0, 80), contexto);
  return { ok: true, message: 'Marcada como salida no conforme.' };
}

function abrirNoConformidad(db, data, contexto) {
  if (!Calidad.gobiernaSgc_(db, contexto)) {
    return { _forbidden: true, message: 'Solo el Encargado del SGC puede abrir la no conformidad.' };
  }
  const p = buscarPrestacion_(db, data && data.prestacion_id);
  if (!p) return { ok: false, message: 'No se encontró la prestación.' };
  if (p.estado !== 'NO_CONFORME') {
    return { ok: false, message: 'Primero marca la prestación como salida no conforme.' };
  }
  if (p.nc_id) return { ok: false, message: 'Esta salida no conforme ya tiene su no conformidad.' };

  const responsable = normalizarEmail_((data && data.responsable_email) || p.responsable_email);
  if (!responsable) return { ok: false, message: 'Asigna un responsable para la no conformidad.' };

  const nc = NoConformidades.crear(db, {
    descripcion: 'Salida no conforme en ' + p.proceso_codigo + ' — ' + p.proceso_nombre +
      ' para ' + p.cliente_nombre + (p.periodo ? ' (' + p.periodo + ')' : '') + '. ' + (p.observaciones || ''),
    // La fuente PROCESO ya existía en el catálogo de NC: no hizo falta
    // inventar una nueva para las salidas no conformes.
    fuente: 'PROCESO',
    origen_ref: p.prestacion_id,
    referencia_normativa: '8.7',
    responsable_email: responsable,
    fecha_deteccion: p.fecha_prestacion
  }, contexto);
  if (nc && (nc._validationError || nc._forbidden)) return nc;

  actualizarFilaPorId_(db, 'SGC_PRESTACIONES', 'prestacion_id', p.prestacion_id, { nc_id: nc.nc_id });
  registrarLogSgc_(db, 'SGC_SALIDA_NC_ABIERTA', p.proceso_codigo + ' → ' + nc.correlativo, contexto);
  return { ok: true, nc_id: nc.nc_id, correlativo: nc.correlativo, message: 'No conformidad ' + nc.correlativo + ' abierta.' };
}

function anular(db, data, contexto) {
  if (!Calidad.gobiernaSgc_(db, contexto)) {
    return { _forbidden: true, message: 'Solo el Encargado del SGC puede anular una prestación.' };
  }
  const p = buscarPrestacion_(db, data && data.prestacion_id);
  if (!p) return { ok: false, message: 'No se encontró la prestación.' };
  actualizarFilaPorId_(db, 'SGC_PRESTACIONES', 'prestacion_id', p.prestacion_id, { activa: false });
  registrarLogSgc_(db, 'SGC_PRESTACION_ANULADA', p.proceso_codigo + ' → ' + p.cliente_nombre, contexto);
  return { ok: true, message: 'Prestación anulada.' };
}

module.exports = { listar, registrar, liberar, marcarNoConforme, abrirNoConformidad, anular };
