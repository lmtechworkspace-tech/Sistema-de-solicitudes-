'use strict';

/**
 * proveedoresSgc.js — puerto de backend/backoffice/Proveedores.gs (SGC ISO
 * 9001, Fase 5a, PRO-04, §8.4: control de los procesos, productos y
 * servicios suministrados externamente).
 *
 * Dos registros del procedimiento, y la relación entre ellos es lo que le
 * da sentido al módulo:
 *   FO-PRO-04-01  Listado de proveedores aprobados  -> SGC_PROVEEDORES
 *   FO-PRO-04-02  Evaluación de proveedores         -> SGC_PROVEEDOR_EVALUACIONES
 *
 * El listado NO se mantiene a mano: el "Resultado evaluación" y el "Estatus"
 * los ESCRIBE la evaluación. Un proveedor no queda reprobado porque alguien
 * lo marque, sino porque sacó 5.0 o menos (PRO-04 §6.2).
 *
 * El proveedor ÚNICO cambia la consecuencia de reprobar: no se desecha (no
 * hay con qué reemplazarlo), se le pide una reunión de mejora.
 */

const crypto = require('node:crypto');
const { leerFilas_, agregarFila_, actualizarFilaPorId_ } = require('../db/sqliteRepo');
const { COLUMNAS } = require('../db/schema');
const Calidad = require('./calidadSgc');
const Notificaciones = require('./notificaciones');
const NotificacionesApp = require('./notificacionesApp');

// Los seis items de PRO-04 §6.2, en el mismo orden en que los enumera el
// procedimiento (a hasta f) y el formulario FO-PRO-04-02.
const CRITERIOS_PROVEEDOR = [
  { campo: 'calidad', etiqueta: 'Calidad en los productos/servicios proporcionados' },
  { campo: 'plazo_entrega', etiqueta: 'Plazo de entrega' },
  { campo: 'costos', etiqueta: 'Costos respecto a los productos/servicios proporcionados' },
  { campo: 'tiempo_respuesta', etiqueta: 'Tiempo de respuesta a consultas' },
  { campo: 'precio', etiqueta: 'Competitividad en el precio' },
  { campo: 'postventa', etiqueta: 'Servicio de postventa' }
];
// Escala cualitativa textual de PRO-04 §6.2 (el procedimiento califica con
// palabras, no solo con el número).
const ESCALA_PROVEEDOR = [
  { desde: 1, hasta: 3.9, etiqueta: 'Malo' },
  { desde: 4, hasta: 6.5, etiqueta: 'Regular' },
  { desde: 6.6, hasta: 10, etiqueta: 'Bueno' }
];
const CORTE_APROBACION_PROVEEDOR = 5.0;
const MESES_EVALUACION_PROVEEDOR = 12;

function uuid_() { return crypto.randomUUID(); }
function errorValidacion_(campo, mensaje) { return { _validationError: true, campo, message: mensaje }; }
function normalizarEmail_(email) { return String(email || '').trim().toLowerCase(); }
function esVerdadero_(v) { return v === true || v === 'TRUE' || v === 1; }
function esActivo_(fila) { return esVerdadero_(fila.activa); }
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
function encolarAviso_(db, destinatario, titulo, mensaje, vidaHoras) {
  if (!destinatario) return;
  NotificacionesApp.encolarLote(db, [{ destinatario, tipo: 'SGC_PROVEEDOR', titulo, mensaje, modulo_id: 'calidad', texto_accion: 'Ver proveedores', vidaHoras: vidaHoras || 72 }]);
}
function encargadosSgc_(db) {
  return leerSeguro_(db, 'SGC_ROLES').filter((r) => esVerdadero_(r.activo) && r.rol_sgc === 'ENCARGADO_SGC').map((r) => normalizarEmail_(r.usuario_email)).filter(Boolean);
}
function esEmailValidoSgc_(email) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(email || '').trim());
}
function sumarMesesSgc_(fecha, meses) {
  const f = new Date(fecha);
  if (isNaN(f.getTime())) return '';
  const r = new Date(f.getTime());
  r.setMonth(r.getMonth() + meses);
  return r.toISOString();
}
function diasHastaSgc_(fecha, ahora) {
  if (!fecha) return null;
  const f = new Date(fecha);
  if (isNaN(f.getTime())) return null;
  return Math.round((f - (ahora || new Date())) / 86400000);
}

// --- helpers -----------------------------------------------------------------
function buscarProveedor_(db, proveedorId) {
  if (!proveedorId) return null;
  return leerSeguro_(db, 'SGC_PROVEEDORES').find((p) => p.proveedor_id === proveedorId && esActivo_(p)) || null;
}
function escalaCualitativaProveedor_(promedio) {
  const e = ESCALA_PROVEEDOR.find((x) => promedio >= x.desde && promedio <= x.hasta);
  return e ? e.etiqueta.toUpperCase() : '';
}
function resumenProveedor_(p, ahora) {
  const dias = p.proxima_evaluacion ? diasHastaSgc_(p.proxima_evaluacion, ahora) : null;
  return {
    proveedor_id: p.proveedor_id, nombre: p.nombre, rut: p.rut, producto_servicio: p.producto_servicio,
    direccion: p.direccion, telefono: p.telefono, email: p.email, nombre_contacto: p.nombre_contacto,
    es_unico: esVerdadero_(p.es_unico), estado: p.estado,
    ultima_evaluacion_fecha: p.ultima_evaluacion_fecha,
    ultima_evaluacion_promedio: p.ultima_evaluacion_promedio === '' ? null : Number(p.ultima_evaluacion_promedio),
    ultima_evaluacion_resultado: p.ultima_evaluacion_resultado, proxima_evaluacion: p.proxima_evaluacion,
    dias_para_evaluacion: dias,
    evaluacion_vencida: p.estado === 'SIN_EVALUAR' || (dias !== null && dias < 0)
  };
}
function indicadoresProveedores_(todos, ahora) {
  const ind = { total: 0, aprobados: 0, reprobados: 0, sin_evaluar: 0, por_evaluar: 0, unicos_reprobados: 0 };
  todos.forEach((p) => {
    ind.total++;
    if (p.estado === 'APROBADO') ind.aprobados++;
    if (p.estado === 'REPROBADO') {
      ind.reprobados++;
      if (esVerdadero_(p.es_unico)) ind.unicos_reprobados++;
    }
    if (p.estado === 'SIN_EVALUAR') ind.sin_evaluar++;
    if (resumenProveedor_(p, ahora).evaluacion_vencida) ind.por_evaluar++;
  });
  return ind;
}
// Aviso inmediato al reprobar: la consecuencia depende de si es único, y es
// justo el momento en que hay que decidir -- dejarlo solo para el resumen
// diario haría que la decisión llegue tarde.
async function avisarProveedorReprobado_(db, proveedor, evaluacion, contexto) {
  const unico = esVerdadero_(proveedor.es_unico);
  const asunto = 'SIGSO — Proveedor reprobado: ' + proveedor.nombre;
  const cuerpo = proveedor.nombre + ' obtuvo ' + evaluacion.promedio + ' en su evaluación (' + evaluacion.resultado +
    '), bajo el corte de ' + CORTE_APROBACION_PROVEEDOR + '.\n\n' +
    (unico
      ? 'Es un PROVEEDOR ÚNICO: según PRO-04 §6.2 no se desecha. Corresponde enviarle un correo solicitando una reunión para pedirle mejorar el servicio.'
      : 'Según PRO-04 §6.2 corresponde dejar de comprarle y buscar un reemplazo.');

  for (const email of encargadosSgc_(db)) {
    await Notificaciones.enviarCorreoModulo(db, {
      solicitudId: 'SGC_PROVEEDOR_REPROBADO_' + evaluacion.evaluacion_id, destinatario: email,
      evento: 'SGC_PROVEEDOR_REPROBADO', asunto, cuerpo
    });
    encolarAviso_(db, email, 'Proveedor reprobado',
      proveedor.nombre + ' obtuvo ' + evaluacion.promedio + '. ' + (unico ? 'Es único: pedir reunión de mejora.' : 'Corresponde reemplazarlo.'));
  }
}

// ===========================================================================
// API publica
// ===========================================================================

function listar(db, data, contexto) {
  const rol = Calidad.rolSgc_(db, contexto);
  const gobierna = Calidad.gobiernaSgc_(db, contexto);
  if (!Calidad.veTodoSgc_(db, contexto, rol, gobierna)) return { _forbidden: true, message: 'No tienes acceso al listado de proveedores.' };

  const filtros = data || {};
  const ahora = new Date();
  const todos = leerSeguro_(db, 'SGC_PROVEEDORES').filter(esActivo_);
  let visibles = todos;
  if (filtros.estado) visibles = visibles.filter((p) => p.estado === filtros.estado);
  if (filtros.busqueda) {
    const q = String(filtros.busqueda).trim().toLowerCase();
    visibles = visibles.filter((p) =>
      String(p.nombre || '').toLowerCase().indexOf(q) !== -1 ||
      String(p.rut || '').toLowerCase().indexOf(q) !== -1 ||
      String(p.producto_servicio || '').toLowerCase().indexOf(q) !== -1);
  }

  return {
    puede_gestionar: gobierna, criterios: CRITERIOS_PROVEEDOR, escala: ESCALA_PROVEEDOR,
    corte_aprobacion: CORTE_APROBACION_PROVEEDOR, indicadores: indicadoresProveedores_(todos, ahora),
    proveedores: visibles.map((p) => resumenProveedor_(p, ahora)).sort((a, b) => String(a.nombre || '').localeCompare(String(b.nombre || '')))
  };
}

function getDetalle(db, data, contexto) {
  const proveedor = buscarProveedor_(db, data.proveedor_id);
  if (!proveedor) return errorValidacion_('proveedor_id', 'Proveedor no encontrado.');
  const rol = Calidad.rolSgc_(db, contexto);
  const gobierna = Calidad.gobiernaSgc_(db, contexto);
  if (!Calidad.veTodoSgc_(db, contexto, rol, gobierna)) return { _forbidden: true, message: 'No tienes acceso a este proveedor.' };

  const evaluaciones = leerSeguro_(db, 'SGC_PROVEEDOR_EVALUACIONES')
    .filter((e) => e.proveedor_id === proveedor.proveedor_id)
    .sort((a, b) => new Date(b.fecha || 0) - new Date(a.fecha || 0))
    .map((e) => ({
      evaluacion_id: e.evaluacion_id, fecha: e.fecha, orden_compra: e.orden_compra,
      calificaciones: CRITERIOS_PROVEEDOR.map((c) => ({ criterio: c.campo, etiqueta: c.etiqueta, valor: Number(e[c.campo]) || 0 })),
      promedio: Number(e.promedio) || 0, resultado: e.resultado, aprobado: esVerdadero_(e.aprobado),
      observaciones: e.observaciones, evaluador_email: e.evaluador_email, proxima_evaluacion: e.proxima_evaluacion
    }));

  return {
    proveedor: resumenProveedor_(proveedor, new Date()), puede_gestionar: gobierna,
    criterios: CRITERIOS_PROVEEDOR, escala: ESCALA_PROVEEDOR, corte_aprobacion: CORTE_APROBACION_PROVEEDOR,
    evaluaciones
  };
}

// --- Alta / edicion del proveedor ----------------------------------------
function guardar(db, data, contexto) {
  if (!Calidad.gobiernaSgc_(db, contexto)) return { _forbidden: true, message: 'Solo el Encargado SGC o un administrador pueden mantener el listado de proveedores.' };
  const nombre = String(data.nombre || '').trim();
  if (!nombre) return errorValidacion_('nombre', 'El nombre o razón social es obligatorio.');
  const producto = String(data.producto_servicio || '').trim();
  if (!producto) return errorValidacion_('producto_servicio', 'Indica qué producto o servicio provee: es la primera columna del listado (FO-PRO-04-01).');
  const email = String(data.email || '').trim();
  if (email && !esEmailValidoSgc_(email)) return errorValidacion_('email', 'El correo del proveedor no es válido.');

  const campos = {
    nombre, rut: String(data.rut || '').trim(), producto_servicio: producto,
    direccion: String(data.direccion || '').trim(), telefono: String(data.telefono || '').trim(), email,
    nombre_contacto: String(data.nombre_contacto || '').trim(), es_unico: data.es_unico === true
  };

  // El RUT identifica al proveedor: repetirlo parte el historial de
  // evaluaciones en dos fichas y arruina el seguimiento de 12 meses. Antes
  // este chequeo solo corria al CREAR -- editar un proveedor para dejarlo
  // con el RUT de otro ya existente no se validaba nunca.
  if (campos.rut) {
    const duplicado = leerSeguro_(db, 'SGC_PROVEEDORES').find((p) =>
      esActivo_(p) && String(p.rut || '').trim() === campos.rut && p.proveedor_id !== data.proveedor_id);
    if (duplicado) return errorValidacion_('rut', 'Ya existe un proveedor con el RUT ' + campos.rut + ' (' + duplicado.nombre + ').');
  }

  if (data.proveedor_id) {
    const existente = buscarProveedor_(db, data.proveedor_id);
    if (!existente) return errorValidacion_('proveedor_id', 'Proveedor no encontrado.');
    const actualizado = actualizarFilaPorId_(db, 'SGC_PROVEEDORES', 'proveedor_id', existente.proveedor_id, campos);
    registrarLogSgc_(db, 'SGC_PROVEEDOR_EDITADO', nombre, contexto);
    return actualizado;
  }

  const proveedor = Object.assign({
    proveedor_id: uuid_(),
    // Nace SIN_EVALUAR y no "aprobado": aprobarlo es el resultado de
    // evaluarlo, no del acto de darlo de alta (PRO-04 §6.2).
    estado: 'SIN_EVALUAR', ultima_evaluacion_fecha: '', ultima_evaluacion_promedio: '', ultima_evaluacion_resultado: '',
    proxima_evaluacion: '', creado_por: (contexto && contexto.email) || '', fecha_creacion: new Date().toISOString(), activa: true
  }, campos);
  agregarFila_(db, 'SGC_PROVEEDORES', proveedor);
  registrarLogSgc_(db, 'SGC_PROVEEDOR_CREADO', nombre, contexto);
  return proveedor;
}

// --- Evaluacion anual (FO-PRO-04-02) -------------------------------------
async function evaluar(db, data, contexto) {
  if (!Calidad.gobiernaSgc_(db, contexto)) return { _forbidden: true, message: 'Solo el Encargado SGC o un administrador pueden evaluar proveedores.' };
  const proveedor = buscarProveedor_(db, data.proveedor_id);
  if (!proveedor) return errorValidacion_('proveedor_id', 'Proveedor no encontrado.');

  const calificaciones = {};
  for (const criterio of CRITERIOS_PROVEEDOR) {
    const valor = Number(data[criterio.campo]);
    if (!(valor >= 1 && valor <= 10)) return errorValidacion_(criterio.campo, 'Califica "' + criterio.etiqueta + '" con una nota de 1 a 10.');
    calificaciones[criterio.campo] = valor;
  }

  const suma = CRITERIOS_PROVEEDOR.reduce((acc, c) => acc + calificaciones[c.campo], 0);
  const promedio = Math.round((suma / CRITERIOS_PROVEEDOR.length) * 100) / 100;
  // "inferior o igual a 5.0" reprueba (PRO-04 §6.2). El corte numerico manda
  // sobre la escala cualitativa: un 5.0 es "Regular" y aun asi reprueba.
  const aprobado = promedio > CORTE_APROBACION_PROVEEDOR;
  const fecha = data.fecha || new Date().toISOString();

  const evaluacion = Object.assign({
    evaluacion_id: uuid_(), proveedor_id: proveedor.proveedor_id, fecha, orden_compra: String(data.orden_compra || '').trim()
  }, calificaciones, {
    promedio, resultado: escalaCualitativaProveedor_(promedio), aprobado,
    observaciones: String(data.observaciones || '').trim(), evaluador_email: normalizarEmail_((contexto && contexto.email) || ''),
    // El seguimiento es cada 12 meses (PRO-04 §6.2), calculado solo.
    proxima_evaluacion: sumarMesesSgc_(fecha, MESES_EVALUACION_PROVEEDOR)
  });
  agregarFila_(db, 'SGC_PROVEEDOR_EVALUACIONES', evaluacion);

  // El listado maestro se actualiza solo: es la columna "Resultado
  // evaluacion" / "Estatus" del FO-PRO-04-01.
  const actualizado = actualizarFilaPorId_(db, 'SGC_PROVEEDORES', 'proveedor_id', proveedor.proveedor_id, {
    estado: aprobado ? 'APROBADO' : 'REPROBADO', ultima_evaluacion_fecha: fecha,
    ultima_evaluacion_promedio: promedio, ultima_evaluacion_resultado: evaluacion.resultado,
    proxima_evaluacion: evaluacion.proxima_evaluacion
  });

  registrarLogSgc_(db, 'SGC_PROVEEDOR_EVALUADO', proveedor.nombre + ' ' + promedio + ' (' + evaluacion.resultado + ')', contexto);

  if (!aprobado) await avisarProveedorReprobado_(db, proveedor, evaluacion, contexto);

  return {
    evaluacion, proveedor: actualizado,
    // El frontend necesita saber QUE hacer con un reprobado, y eso depende
    // de si es unico o no. Se resuelve aca y no en la pantalla para que la
    // regla del procedimiento viva en un solo lugar.
    consecuencia: !aprobado ? (esVerdadero_(proveedor.es_unico) ? 'REUNION_MEJORA' : 'DESECHAR') : ''
  };
}

// --- Baja del listado -----------------------------------------------------
function desactivar(db, data, contexto) {
  if (!Calidad.gobiernaSgc_(db, contexto)) return { _forbidden: true, message: 'Solo el Encargado SGC o un administrador pueden dar de baja un proveedor.' };
  const proveedor = buscarProveedor_(db, data.proveedor_id);
  if (!proveedor) return errorValidacion_('proveedor_id', 'Proveedor no encontrado.');
  const motivo = String(data.motivo || '').trim();
  if (motivo.length < 10) return errorValidacion_('motivo', 'Explica por qué se da de baja (mínimo 10 caracteres).');
  // Baja logica: las evaluaciones pasadas siguen siendo evidencia de que el
  // control de §8.4 se aplicaba, aunque hoy ya no se le compre.
  const actualizado = actualizarFilaPorId_(db, 'SGC_PROVEEDORES', 'proveedor_id', proveedor.proveedor_id, { activa: false });
  registrarLogSgc_(db, 'SGC_PROVEEDOR_BAJA', proveedor.nombre + ' — ' + motivo, contexto);
  return actualizado;
}

// --- avisos diarios -----------------------------------------------------------
async function recordatorioPendientes(db) {
  const ahora = new Date();
  const hoy = ahora.toISOString().slice(0, 10);
  const encargados = encargadosSgc_(db);
  if (!encargados.length) return { avisos: 0 };

  let avisos = 0;
  const vencidos = [];
  const reprobados = [];

  leerSeguro_(db, 'SGC_PROVEEDORES').filter(esActivo_).forEach((p) => {
    if (p.proxima_evaluacion) {
      const limite = new Date(p.proxima_evaluacion);
      if (!isNaN(limite.getTime()) && limite < ahora) vencidos.push(p);
      // Nunca evaluado: tambien es un incumplimiento de §8.4, no un vacio
      // que se pueda dejar pasar.
    } else if (p.estado === 'SIN_EVALUAR') {
      vencidos.push(p);
    }
    if (p.estado === 'REPROBADO') reprobados.push(p);
  });

  if (vencidos.length) {
    const cuerpo = 'Estos proveedores necesitan su evaluación anual (PRO-04 §6.2):\n\n' +
      vencidos.map((p) => '· ' + p.nombre + ' — ' + p.producto_servicio +
        (p.proxima_evaluacion ? ' (vencía el ' + String(p.proxima_evaluacion).slice(0, 10) + ')' : ' (nunca evaluado)')).join('\n');
    for (const email of encargados) {
      const r = await Notificaciones.enviarCorreoModulo(db, { solicitudId: 'SGC_PROVEEDOR_EVAL_VENCIDA:' + hoy, destinatario: email, evento: 'SGC_PROVEEDOR_EVAL_VENCIDA', asunto: 'SIGSO — ' + vencidos.length + ' proveedor(es) por evaluar', cuerpo, ventanaMinutos: 24 * 60 });
      if (r && r.enviado) avisos++;
      encolarAviso_(db, email, 'Evaluación de proveedores pendiente', vencidos.length + ' proveedor(es) esperan su evaluación anual.');
    }
  }

  if (reprobados.length) {
    const cuerpo = 'Estos proveedores están REPROBADOS (promedio ≤ ' + CORTE_APROBACION_PROVEEDOR + '):\n\n' +
      reprobados.map((p) => '· ' + p.nombre + ' — ' + p.ultima_evaluacion_promedio +
        (esVerdadero_(p.es_unico) ? ' — PROVEEDOR ÚNICO: corresponde pedirle una reunión de mejora, no desecharlo.' : ' — corresponde dejar de comprarle (PRO-04 §6.2).')).join('\n');
    for (const email of encargados) {
      const r = await Notificaciones.enviarCorreoModulo(db, { solicitudId: 'SGC_PROVEEDOR_REPROBADO:' + hoy, destinatario: email, evento: 'SGC_PROVEEDOR_REPROBADO', asunto: 'SIGSO — ' + reprobados.length + ' proveedor(es) reprobados', cuerpo, ventanaMinutos: 24 * 60 });
      if (r && r.enviado) avisos++;
    }
  }

  return { avisos, vencidos: vencidos.length, reprobados: reprobados.length };
}

module.exports = { listar, getDetalle, guardar, evaluar, desactivar, recordatorioPendientes };
