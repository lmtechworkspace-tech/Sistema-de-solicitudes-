'use strict';

/**
 * quejasSgc.js — puerto de backend/backoffice/Quejas.gs (SGC ISO 9001, Fase
 * 4, PRO-07). Las Partes 2 a 5 del FO-PRO-07-01, sobre la fila que ya creó
 * el formulario público (Intake, Parte 1 -- no portado aún, fuera del
 * alcance de este incremento). Mismo patrón de "una fila = un formulario
 * completo" que SGC_NC y SGC_AUDITORIAS.
 *
 * Ciclo: RECIBIDA -> (registrar recepción) -> EN_INVESTIGACION -> (investigar)
 * -> EN_RESOLUCION -> RESUELTA -> NOTIFICADA -> CERRADA/REABIERTA. O cierra
 * antes: NO_VALIDA (investigación no la valida) / NO_PROCEDE (no corresponde
 * procesarla).
 *
 * DOS DECISIONES PORTADAS TAL CUAL:
 * 1) El investigador NO puede ser del área que originó la queja (PRO-07
 *    §6.2) -- mismo principio de imparcialidad que la auditoría interna
 *    (§9.2.2), validado igual: contra el área del rol SGC de la persona.
 * 2) Cuando corresponde levantar una NC, se crea con NoConformidades.crear
 *    (fuente QUEJA, origen_ref = queja_id) -- mismo eslabón que ya conecta
 *    auditoría -> hallazgo -> NC.
 *
 * Plazos: 30 días CORRIDOS (no hábiles) desde la validación hasta el cierre,
 * y 30 días corridos de seguimiento desde la notificación -- PRO-07 lo
 * especifica así explícitamente, a diferencia de PRO-03/PRO-06.
 */

const { leerFilas_, agregarFila_, actualizarFilaPorId_ } = require('../db/sqliteRepo');
const { COLUMNAS } = require('../db/schema');
const Calidad = require('./calidadSgc');
const NoConformidades = require('./noConformidadesSgc');
const Notificaciones = require('./notificaciones');
const NotificacionesApp = require('./notificacionesApp');

const ESTADOS_QUEJA_ABIERTOS = ['RECIBIDA', 'EN_INVESTIGACION', 'EN_RESOLUCION', 'RESUELTA', 'NOTIFICADA', 'REABIERTA'];
// PRO-07 §6.1 c.4: desde la validación hasta el cierre, máximo 30 días
// CORRIDOS (no hábiles -- el procedimiento lo especifica así).
const DIAS_RESOLUCION_QUEJA = 30;
// PRO-07 §6.1 c.7: seguimiento 30 días corridos desde la respuesta final.
const DIAS_SEGUIMIENTO_QUEJA = 30;

function errorValidacion_(campo, mensaje) { return { _validationError: true, campo, message: mensaje }; }
function normalizarEmail_(email) { return String(email || '').trim().toLowerCase(); }
function esVerdadero_(v) { return v === true || v === 'TRUE' || v === 1; }
function esActivo_(fila) { return esVerdadero_(fila.activa); }
function leer_(db, hoja) { return leerFilas_(db, hoja, COLUMNAS[hoja]); }
function leerSeguro_(db, hoja) { try { return leer_(db, hoja); } catch (err) { return []; } }
function registrarLogSgc_(db, accion, detalle, contexto) {
  try {
    agregarFila_(db, 'LOG_SISTEMA', {
      log_id: require('node:crypto').randomUUID(), timestamp: new Date().toISOString(), contexto: accion,
      mensaje: ((contexto && contexto.email) || '') + ' → ' + detalle, ref: 'SGC'
    });
  } catch (err) { /* trazabilidad, no el flujo principal */ }
}
function encolarAviso_(db, destinatario, titulo, mensaje, vidaHoras) {
  if (!destinatario) return;
  NotificacionesApp.encolarLote(db, [{ destinatario, tipo: 'SGC_QUEJA', titulo, mensaje, modulo_id: 'calidad', texto_accion: 'Ver quejas', vidaHoras: vidaHoras || 72 }]);
}
function encargadosSgc_(db) {
  return leerSeguro_(db, 'SGC_ROLES').filter((r) => esVerdadero_(r.activo) && r.rol_sgc === 'ENCARGADO_SGC').map((r) => normalizarEmail_(r.usuario_email)).filter(Boolean);
}

// --- helpers -----------------------------------------------------------------
function buscarQueja_(db, quejaId) {
  if (!quejaId) return null;
  return leerSeguro_(db, 'SGC_QUEJAS').find((q) => q.queja_id === quejaId && esActivo_(q)) || null;
}
function puedeInvestigarQueja_(db, queja, contexto) {
  if (Calidad.gobiernaSgc_(db, contexto)) return true;
  return normalizarEmail_(queja.investigador_email) === normalizarEmail_(contexto && contexto.email);
}
// PRO-07 §6.2: "la investigación deberá ser realizada por una o varias
// personas que no hayan participado en las actividades que dieron origen a
// la queja". Se valida contra el área del rol SGC -- mismo principio que el
// conflicto de interés de auditoría interna (§9.2.2).
function investigadorConConflicto_(db, investigadorEmail, areaQueja) {
  if (!areaQueja) return null;
  if (Calidad.areaSgc_(db, { email: investigadorEmail }) === areaQueja) {
    return errorValidacion_('investigador_email', 'Esa persona pertenece al área que originó la queja: no puede investigar su propio trabajo (PRO-07 §6.2).');
  }
  return null;
}
// Días CORRIDOS (no hábiles): PRO-07 los especifica así, a diferencia de
// PRO-03/PRO-06. Fin del día (23:59:59 UTC) para que "vence hoy" cuente
// como vencido recién después, mismo criterio que sumarDiasHabilesSgc_.
function sumarDiasCorridosQueja_(desde, dias) {
  const f = new Date(desde);
  if (isNaN(f.getTime())) return '';
  const r = new Date(f.getTime());
  r.setDate(r.getDate() + dias);
  r.setUTCHours(23, 59, 59, 0);
  return r.toISOString();
}
function plazoActualQueja_(queja) {
  if (queja.estado === 'EN_RESOLUCION') return { etapa: 'Resolución', plazo: queja.resolucion_plazo };
  if (queja.estado === 'NOTIFICADA') return { etapa: 'Seguimiento', plazo: queja.seguimiento_plazo };
  return { etapa: '', plazo: '' };
}
function resumenQueja_(queja, ahora) {
  const venc = plazoActualQueja_(queja);
  const dias = venc.plazo ? Math.ceil((new Date(venc.plazo) - ahora) / 86400000) : null;
  return {
    queja_id: queja.queja_id, correlativo: queja.correlativo, nombre_completo: queja.nombre_completo,
    empresa: queja.empresa, tipo: queja.tipo, area: queja.area, canal: queja.canal,
    descripcion: queja.descripcion, fecha_envio: queja.fecha_envio, estado: queja.estado,
    investigador_email: queja.investigador_email, etapa_actual: venc.etapa, plazo_actual: venc.plazo,
    dias_para_plazo: dias, vencida: dias !== null && dias < 0 && ESTADOS_QUEJA_ABIERTOS.indexOf(queja.estado) !== -1,
    tiene_nc: !!queja.nc_id
  };
}
// Indicadores del Objetivo de Calidad N°2 (DOC-07: "< 2% de reclamos sobre
// total de servicios") y lo que la revisión por la dirección (Fase 5b) va a
// necesitar mostrar.
function indicadoresQueja_(todas, ahora) {
  const anio = ahora.getFullYear();
  const delAnio = todas.filter((q) => { const f = new Date(q.fecha_envio); return !isNaN(f.getTime()) && f.getFullYear() === anio; });
  const abiertas = todas.filter((q) => ESTADOS_QUEJA_ABIERTOS.indexOf(q.estado) !== -1);
  const vencidas = abiertas.filter((q) => { const venc = plazoActualQueja_(q); return venc.plazo && new Date(venc.plazo) < ahora; });
  return {
    total_anio: delAnio.length,
    quejas_anio: delAnio.filter((q) => q.tipo === 'QUEJA' || q.tipo === 'RECLAMACION').length,
    felicitaciones_anio: delAnio.filter((q) => q.tipo === 'FELICITACION').length,
    consultas_anio: delAnio.filter((q) => q.tipo === 'CONSULTA').length,
    abiertas: abiertas.length, vencidas: vencidas.length,
    cerradas: todas.filter((q) => q.estado === 'CERRADA').length
  };
}

// ===========================================================================
// API publica
// ===========================================================================

function listar(db, data, contexto) {
  const filtros = data || {};
  const rol = Calidad.rolSgc_(db, contexto);
  const gobierna = Calidad.gobiernaSgc_(db, contexto);
  const email = normalizarEmail_(contexto.email);

  const todas = leerSeguro_(db, 'SGC_QUEJAS').filter(esActivo_);
  let visibles = todas.filter((q) => {
    if (Calidad.veTodoSgc_(db, contexto, rol, gobierna)) return true;
    return normalizarEmail_(q.investigador_email) === email;
  });
  if (filtros.estado) visibles = visibles.filter((q) => q.estado === filtros.estado);
  if (filtros.abiertas) visibles = visibles.filter((q) => ESTADOS_QUEJA_ABIERTOS.indexOf(q.estado) !== -1);

  const ahora = new Date();
  return {
    puede_gestionar: gobierna,
    indicadores: indicadoresQueja_(todas, ahora),
    quejas: visibles.map((q) => resumenQueja_(q, ahora)).sort((a, b) => new Date(b.fecha_envio || 0) - new Date(a.fecha_envio || 0))
  };
}

function getDetalle(db, data, contexto) {
  const queja = buscarQueja_(db, data.queja_id);
  if (!queja) return errorValidacion_('queja_id', 'Queja no encontrada.');
  const rol = Calidad.rolSgc_(db, contexto);
  const gobierna = Calidad.gobiernaSgc_(db, contexto);
  const email = normalizarEmail_(contexto.email);
  if (!Calidad.veTodoSgc_(db, contexto, rol, gobierna) && normalizarEmail_(queja.investigador_email) !== email) {
    return { _forbidden: true, message: 'No tienes acceso a esta queja.' };
  }
  const nc = queja.nc_id ? leerSeguro_(db, 'SGC_NC').find((n) => n.nc_id === queja.nc_id) : null;

  return {
    queja, puede_gestionar: gobierna,
    puede_investigar: gobierna || normalizarEmail_(queja.investigador_email) === email,
    resumen: resumenQueja_(queja, new Date()),
    nc_correlativo: nc ? nc.correlativo : '', nc_estado: nc ? nc.estado : ''
  };
}

// --- 2) Registro interno: ¿procede? -----------------------------------------
async function registrarRecepcion(db, data, contexto) {
  const queja = buscarQueja_(db, data.queja_id);
  if (!queja) return errorValidacion_('queja_id', 'Queja no encontrada.');
  if (!Calidad.gobiernaSgc_(db, contexto)) return { _forbidden: true, message: 'Solo el Encargado SGC o un administrador pueden registrar la recepción.' };
  if (queja.estado !== 'RECIBIDA') return errorValidacion_('queja_id', 'Esta queja ya fue procesada.');
  const procede = esVerdadero_(data.procede);
  if (!procede && !String(data.motivo_no_procede || '').trim()) {
    return errorValidacion_('motivo_no_procede', 'Si no procede, explica por qué (fuera de plazo, servicio suspendido, etc.).');
  }
  const ahora = new Date().toISOString();
  const actualizada = actualizarFilaPorId_(db, 'SGC_QUEJAS', 'queja_id', queja.queja_id, {
    fecha_recepcion: ahora, procede, motivo_no_procede: procede ? '' : String(data.motivo_no_procede || '').trim(),
    registrado_por: normalizarEmail_(contexto.email), estado: procede ? 'EN_INVESTIGACION' : 'NO_PROCEDE',
    fecha_cierre: procede ? '' : ahora, cerrada_por: procede ? '' : normalizarEmail_(contexto.email)
  });
  registrarLogSgc_(db, 'SGC_QUEJA_RECEPCION', queja.correlativo + ': ' + (procede ? 'procede' : 'no procede'), contexto);
  if (!procede) {
    await Notificaciones.enviarCorreoModulo(db, {
      solicitudId: 'SGC_QUEJA_NO_PROCEDE:' + queja.queja_id, destinatario: queja.email, evento: 'SGC_QUEJA_NO_PROCEDE',
      asunto: 'HomePymes — Sobre tu mensaje ' + queja.correlativo,
      cuerpo: 'Hola ' + queja.nombre_completo + ',\n\nRevisamos tu mensaje (' + queja.correlativo + ') y no corresponde ' +
        'procesarlo como queja formal.\n\nMotivo: ' + actualizada.motivo_no_procede
    });
  }
  return actualizada;
}

// --- 3) Investigacion (imparcialidad: PRO-07 §6.2) --------------------------
function registrarInvestigacion(db, data, contexto) {
  const queja = buscarQueja_(db, data.queja_id);
  if (!queja) return errorValidacion_('queja_id', 'Queja no encontrada.');
  if (!Calidad.gobiernaSgc_(db, contexto)) return { _forbidden: true, message: 'Solo el Encargado SGC o un administrador pueden asignar la investigación.' };
  if (queja.estado !== 'EN_INVESTIGACION') return errorValidacion_('queja_id', 'Esta queja no está en etapa de investigación.');
  const investigador = normalizarEmail_(data.investigador_email);
  if (!investigador) return errorValidacion_('investigador_email', 'Asigna quién investiga.');
  const conflicto = investigadorConConflicto_(db, investigador, queja.area);
  if (conflicto) return conflicto;

  return actualizarFilaPorId_(db, 'SGC_QUEJAS', 'queja_id', queja.queja_id, { investigador_email: investigador });
}

// Se separa de la asignación: el Encargado SGC asigna primero, y el
// investigador (o el propio Encargado) vuelve después con el resultado.
async function registrarResultado(db, data, contexto) {
  const queja = buscarQueja_(db, data.queja_id);
  if (!queja) return errorValidacion_('queja_id', 'Queja no encontrada.');
  if (!puedeInvestigarQueja_(db, queja, contexto)) return { _forbidden: true, message: 'Solo el investigador asignado o el Encargado SGC pueden registrar el resultado.' };
  if (queja.estado !== 'EN_INVESTIGACION') return errorValidacion_('queja_id', 'Esta queja no está en etapa de investigación.');
  if (!queja.investigador_email) return errorValidacion_('queja_id', 'Primero asigna quién investiga.');
  const resultado = String(data.resultado_investigacion || '').trim();
  if (!resultado) return errorValidacion_('resultado_investigacion', 'Describe el resultado de la investigación.');
  const valida = esVerdadero_(data.valida);
  const ahora = new Date();

  const cambios = { resultado_investigacion: resultado, valida, estado: valida ? 'EN_RESOLUCION' : 'NO_VALIDA' };
  if (valida) {
    cambios.resolucion_plazo = sumarDiasCorridosQueja_(ahora, DIAS_RESOLUCION_QUEJA);
  } else {
    if (!String(data.justificacion || '').trim()) {
      return errorValidacion_('justificacion', 'Si la queja no es válida, explica por qué: se adjunta a la respuesta del cliente.');
    }
    cambios.accion_implementada = String(data.justificacion || '').trim();
    cambios.fecha_cierre = ahora.toISOString();
    cambios.cerrada_por = normalizarEmail_(contexto.email);
  }
  const actualizada = actualizarFilaPorId_(db, 'SGC_QUEJAS', 'queja_id', queja.queja_id, cambios);
  registrarLogSgc_(db, 'SGC_QUEJA_INVESTIGADA', queja.correlativo + ': ' + (valida ? 'válida' : 'no válida'), contexto);

  if (!valida) {
    await Notificaciones.enviarCorreoModulo(db, {
      solicitudId: 'SGC_QUEJA_NO_VALIDA:' + queja.queja_id, destinatario: queja.email, evento: 'SGC_QUEJA_NO_VALIDA',
      asunto: 'HomePymes — Resultado de tu mensaje ' + queja.correlativo,
      cuerpo: 'Hola ' + queja.nombre_completo + ',\n\nRevisamos tu mensaje (' + queja.correlativo + ') y, tras la investigación, ' +
        'no encontramos elementos que la validen.\n\n' + cambios.accion_implementada
    });
  }
  return actualizada;
}

// --- 4) Resolucion (plazo 30 dias CORRIDOS desde la validacion) -------------
function registrarResolucion(db, data, contexto) {
  const queja = buscarQueja_(db, data.queja_id);
  if (!queja) return errorValidacion_('queja_id', 'Queja no encontrada.');
  if (!Calidad.gobiernaSgc_(db, contexto)) return { _forbidden: true, message: 'Solo el Encargado SGC o un administrador pueden registrar la resolución.' };
  if (queja.estado !== 'EN_RESOLUCION') return errorValidacion_('queja_id', 'Esta queja no está en etapa de resolución.');
  const accion = String(data.accion_implementada || '').trim();
  if (!accion) return errorValidacion_('accion_implementada', 'Describe la acción o corrección implementada.');

  return actualizarFilaPorId_(db, 'SGC_QUEJAS', 'queja_id', queja.queja_id, {
    accion_implementada: accion, fecha_resolucion: data.fecha_resolucion || new Date().toISOString(),
    responsable_resolucion: normalizarEmail_(contexto.email), estado: 'RESUELTA'
  });
}

// El eslabon que conecta con la Fase 3a: mismo patron que el hallazgo de
// auditoria que se convierte en no conformidad.
function convertirEnNc(db, data, contexto) {
  const queja = buscarQueja_(db, data.queja_id);
  if (!queja) return errorValidacion_('queja_id', 'Queja no encontrada.');
  if (!Calidad.gobiernaSgc_(db, contexto)) return { _forbidden: true, message: 'Solo el Encargado SGC o un administrador pueden levantar no conformidades.' };
  if (queja.nc_id) return errorValidacion_('queja_id', 'Esta queja ya tiene su no conformidad.');
  if (ESTADOS_QUEJA_ABIERTOS.indexOf(queja.estado) === -1) return errorValidacion_('queja_id', 'La queja tiene que estar en curso para levantar una no conformidad.');
  const responsable = normalizarEmail_(data.responsable_email) || normalizarEmail_(queja.investigador_email);
  if (!responsable) return errorValidacion_('responsable_email', 'Asigna un responsable para la no conformidad.');

  const nc = NoConformidades.crear(db, {
    descripcion: queja.descripcion, fuente: 'QUEJA', origen_ref: queja.queja_id,
    area_id: queja.area, responsable_email: responsable, fecha_deteccion: queja.fecha_envio
  }, contexto);
  if (nc && (nc._validationError || nc._forbidden)) return nc;

  actualizarFilaPorId_(db, 'SGC_QUEJAS', 'queja_id', queja.queja_id, { nc_id: nc.nc_id });
  registrarLogSgc_(db, 'SGC_QUEJA_A_NC', queja.correlativo + ' -> ' + nc.correlativo, contexto);
  return { queja_id: queja.queja_id, nc };
}

// --- 5) Notificacion y seguimiento -------------------------------------------
async function registrarNotificacion(db, data, contexto) {
  const queja = buscarQueja_(db, data.queja_id);
  if (!queja) return errorValidacion_('queja_id', 'Queja no encontrada.');
  if (!Calidad.gobiernaSgc_(db, contexto)) return { _forbidden: true, message: 'Solo el Encargado SGC o un administrador pueden notificar al cliente.' };
  if (queja.estado !== 'RESUELTA') return errorValidacion_('queja_id', 'Primero registra la resolución.');
  const revisadoPor = normalizarEmail_(data.revisado_por);
  if (!revisadoPor) return errorValidacion_('revisado_por', 'Indica quién revisó y aprobó la respuesta.');

  const ahora = new Date();
  const actualizada = actualizarFilaPorId_(db, 'SGC_QUEJAS', 'queja_id', queja.queja_id, {
    fecha_notificacion: ahora.toISOString(), revisado_por: revisadoPor,
    seguimiento_plazo: sumarDiasCorridosQueja_(ahora, DIAS_SEGUIMIENTO_QUEJA), estado: 'NOTIFICADA'
  });
  registrarLogSgc_(db, 'SGC_QUEJA_NOTIFICADA', queja.correlativo, contexto);

  await Notificaciones.enviarCorreoModulo(db, {
    solicitudId: 'SGC_QUEJA_RESPUESTA:' + queja.queja_id, destinatario: queja.email, evento: 'SGC_QUEJA_RESPUESTA',
    asunto: 'HomePymes — Respuesta a tu mensaje ' + queja.correlativo,
    cuerpo: 'Hola ' + queja.nombre_completo + ',\n\nEsto es lo que hicimos con tu mensaje (' + queja.correlativo + '):\n\n' + queja.accion_implementada
  });
  return actualizada;
}

function registrarSeguimiento(db, data, contexto) {
  const queja = buscarQueja_(db, data.queja_id);
  if (!queja) return errorValidacion_('queja_id', 'Queja no encontrada.');
  if (!Calidad.gobiernaSgc_(db, contexto)) return { _forbidden: true, message: 'Solo el Encargado SGC o un administrador pueden registrar el seguimiento.' };
  if (queja.estado !== 'NOTIFICADA') return errorValidacion_('queja_id', 'Primero notifica la respuesta al cliente.');
  const conforme = esVerdadero_(data.cliente_conforme);
  const ahora = new Date().toISOString();
  if (conforme) {
    const cerrada = actualizarFilaPorId_(db, 'SGC_QUEJAS', 'queja_id', queja.queja_id, {
      fecha_seguimiento: ahora, cliente_conforme: true, estado: 'CERRADA', fecha_cierre: ahora, cerrada_por: normalizarEmail_(contexto.email)
    });
    registrarLogSgc_(db, 'SGC_QUEJA_CERRADA', queja.correlativo, contexto);
    return cerrada;
  }
  // No conforme: se reabre. Igual que una NC con eficacia negativa, no se
  // borra nada de lo anterior -- queda en el log y en la fila.
  const reabierta = actualizarFilaPorId_(db, 'SGC_QUEJAS', 'queja_id', queja.queja_id, { fecha_seguimiento: ahora, cliente_conforme: false, estado: 'REABIERTA' });
  registrarLogSgc_(db, 'SGC_QUEJA_REABIERTA', queja.correlativo, contexto);
  return reabierta;
}

function anular(db, data, contexto) {
  const queja = buscarQueja_(db, data.queja_id);
  if (!queja) return errorValidacion_('queja_id', 'Queja no encontrada.');
  if (!Calidad.gobiernaSgc_(db, contexto)) return { _forbidden: true, message: 'Solo el Encargado SGC o un administrador pueden anular una queja.' };
  const motivo = String(data.motivo || '').trim();
  if (!motivo) return errorValidacion_('motivo', 'Explica por qué se anula: queda en el registro.');
  if (queja.estado === 'CERRADA') return errorValidacion_('queja_id', 'Una queja cerrada no se anula.');
  const anulada = actualizarFilaPorId_(db, 'SGC_QUEJAS', 'queja_id', queja.queja_id, {
    estado: 'ANULADA', fecha_cierre: new Date().toISOString(), cerrada_por: normalizarEmail_(contexto.email)
  });
  registrarLogSgc_(db, 'SGC_QUEJA_ANULADA', queja.correlativo + ': ' + motivo, contexto);
  return anulada;
}

// --- avisos diarios -----------------------------------------------------------
// Dos plazos, ambos en dias CORRIDOS (a diferencia de PRO-03/PRO-06 que usan
// dias habiles -- PRO-07 lo especifica asi explicitamente): resolucion
// vencida y seguimiento vencido, ambos diarios al Encargado SGC.
async function recordatorioPendientes(db) {
  const todas = leerSeguro_(db, 'SGC_QUEJAS').filter(esActivo_);
  const ahora = new Date();
  const hoy = ahora.toISOString().slice(0, 10);
  const encargados = encargadosSgc_(db);
  let avisos = 0;

  async function avisarVencidas_(lista, clave, tituloCorreo, etiquetaPlazo) {
    if (!lista.length) return;
    const cuerpo = 'Estas quejas tienen ' + etiquetaPlazo + ' vencido:\n' +
      lista.map((q) => '- ' + q.correlativo + ' (' + q.nombre_completo + ')').join('\n') +
      '\n\nEntra a SIGSO > Calidad > Quejas.';
    for (const email of encargados) {
      const r = await Notificaciones.enviarCorreoModulo(db, { solicitudId: clave + ':' + hoy, destinatario: email, evento: clave, asunto: 'SIGSO — ' + tituloCorreo, cuerpo, ventanaMinutos: 24 * 60 });
      if (r && r.enviado) avisos++;
      encolarAviso_(db, email, tituloCorreo, lista.length + ' queja(s) con plazo vencido.');
    }
  }

  await avisarVencidas_(
    todas.filter((q) => q.estado === 'EN_RESOLUCION' && q.resolucion_plazo && new Date(q.resolucion_plazo) < ahora),
    'SGC_QUEJA_RESOLUCION_VENCIDA', 'Quejas con plazo de resolución vencido', 'el plazo de resolución (30 días corridos)'
  );
  await avisarVencidas_(
    todas.filter((q) => q.estado === 'NOTIFICADA' && q.seguimiento_plazo && new Date(q.seguimiento_plazo) < ahora),
    'SGC_QUEJA_SEGUIMIENTO_VENCIDO', 'Quejas con seguimiento pendiente', 'el plazo de seguimiento (30 días corridos)'
  );

  return { avisos };
}

module.exports = {
  listar, getDetalle, registrarRecepcion, registrarInvestigacion, registrarResultado,
  registrarResolucion, convertirEnNc, registrarNotificacion, registrarSeguimiento, anular,
  recordatorioPendientes
};
