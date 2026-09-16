'use strict';

/**
 * solicitudesBackoffice.js — puerto de backend/backoffice/Solicitudes.gs
 * (maquina de estados y prioridad, §8/§7.2): actualizarEstado,
 * actualizarPrioridad (+asignarResponsables_), comprometerFecha,
 * derivarSolicitud (+planificarDerivacion_/aplicarDerivacion_),
 * editarContenidoSubsolicitud, getDetalle.
 *
 * NO incluido en este porteo (documentado, no fingido):
 *  - El correo HTML branded + adjunto PDF de la Orden de Trabajo en
 *    derivarSolicitud: depende de Documentos.gs (generacion de PDF), no
 *    portado. notificarDerivacion aqui es texto simple.
 *  - getDetalle no incluye el ambito de Jefatura para el panel completo
 *    (eso es Jefatura.getPanel, tampoco portado) -- solo el GUARDIA que
 *    decide si un JEFATURA puede abrir ESTA solicitud puntual.
 *
 * `contexto` = { email, rol, rol_origen } -- rol_origen (agregado al portar
 * Auth, ver server/router.js) es lo que permite fueraDeSuPropioTrabajo_
 * detectar una cuenta SOLICITANTE normalizada a DEV.
 */

const crypto = require('node:crypto');
const { agregarFila_, leerFilas_, actualizarFilaPorId_ } = require('../db/sqliteRepo');
const { COLUMNAS } = require('../db/schema');
const { errorValidacion, errorForbidden } = require('./errores');
const {
  ESTADOS, ESTADOS_CERRADOS, ORDEN_ESTADOS, ESTADOS_EXCLUIDOS_DERIVACION, ORDEN_PRIORIDAD
} = require('./constantesSolicitudes');
const Notificaciones = require('./notificaciones');
const Cumplimiento = require('./cumplimiento');
const Jefatura = require('./jefatura');

function normalizarEmail_(email) {
  return String(email || '').trim().toLowerCase();
}

/**
 * "Su propio trabajo" se lee de la forma que NO puede conceder de mas: el
 * item esta asignado a esa persona. Solo aplica a una cuenta SOLICITANTE
 * normalizada a DEV (ver router.js) -- el personal de plantilla (DEV/ANA de
 * verdad) SI puede tocar el trabajo de un companero, decision tomada aparte.
 */
function fueraDeSuPropioTrabajo_(contexto, subsolicitud, accion) {
  if (!contexto || contexto.rol_origen !== 'SOLICITANTE') return null;
  const suyo = normalizarEmail_(subsolicitud && subsolicitud.desarrollador_asignado) === normalizarEmail_(contexto.email);
  if (suyo) return null;
  return errorForbidden('Tu cuenta solo puede ' + accion + ' en los items que tiene asignados.');
}

function buscarSolicitudPorId_(db, solicitudId) {
  return leerFilas_(db, 'SOLICITUDES', COLUMNAS.SOLICITUDES).find((f) => f.solicitud_id === solicitudId) || null;
}

function buscarSubsolicitud_(db, subsolicitudId) {
  return leerFilas_(db, 'SUBSOLICITUDES', COLUMNAS.SUBSOLICITUDES).find((f) => f.subsolicitud_id === subsolicitudId) || null;
}

function obtenerSubsolicitudesDeSolicitud_(db, solicitudId) {
  return leerFilas_(db, 'SUBSOLICITUDES', COLUMNAS.SUBSOLICITUDES).filter((s) => s.solicitud_id === solicitudId);
}

// RN-201: la unica "entrega" que el gestor puede cerrar directo sin pasar
// por la validacion del solicitante es una consulta tecnica (tipo CON).
function esConsultaTecnica_(subsolicitud) {
  return subsolicitud.tipo === 'CON';
}

function comentarioObligatorioParaCambio_(estadoActual, estadoNuevo) {
  if (estadoNuevo === ESTADOS.S06) return true;
  if (estadoNuevo === ESTADOS.S10 || estadoNuevo === ESTADOS.S11) return true;
  if (estadoNuevo === ESTADOS.S09 && estadoActual !== ESTADOS.S08) return true;
  if (ESTADOS_CERRADOS.indexOf(estadoActual) !== -1) return true;
  return false;
}

// §8.2: estado del padre = el MINIMO (menos avanzado) entre subsolicitudes
// no excluidas (S10/S11).
function calcularEstadoDerivado_(estadosSubsolicitudes) {
  const activas = estadosSubsolicitudes.filter((e) => ESTADOS_EXCLUIDOS_DERIVACION.indexOf(e) === -1);
  if (activas.length === 0) {
    return estadosSubsolicitudes.indexOf(ESTADOS.S10) !== -1 ? ESTADOS.S10 : ESTADOS.S11;
  }
  const todasS09 = activas.every((e) => e === ESTADOS.S09);
  if (todasS09) return ESTADOS.S09;
  return activas.reduce((masAtrasado, actual) =>
    ORDEN_ESTADOS.indexOf(actual) < ORDEN_ESTADOS.indexOf(masAtrasado) ? actual : masAtrasado);
}

function recalcularEstadoDerivado_(db, solicitudId) {
  const estados = obtenerSubsolicitudesDeSolicitud_(db, solicitudId).map((s) => s.estado);
  const estadoDerivado = calcularEstadoDerivado_(estados);
  actualizarFilaPorId_(db, 'SOLICITUDES', 'solicitud_id', solicitudId, { estado_derivado: estadoDerivado });
  return estadoDerivado;
}

function prioridadMasCritica_(listaPrioridades) {
  return listaPrioridades.reduce(
    (masCritica, actual) => (ORDEN_PRIORIDAD.indexOf(actual) < ORDEN_PRIORIDAD.indexOf(masCritica) ? actual : masCritica),
    'P5'
  );
}

function recalcularPrioridadDerivada_(db, solicitudId) {
  const prioridades = obtenerSubsolicitudesDeSolicitud_(db, solicitudId).map((s) => s.prioridad);
  const prioridadDerivada = prioridadMasCritica_(prioridades);
  actualizarFilaPorId_(db, 'SOLICITUDES', 'solicitud_id', solicitudId, { prioridad_derivada: prioridadDerivada });
  return prioridadDerivada;
}

function obtenerSlaHoras_(db, prioridad) {
  const fila = leerFilas_(db, 'CONFIG_SLA', COLUMNAS.CONFIG_SLA).find((f) => f.prioridad === prioridad);
  if (!fila) return '';
  return fila.sla_horas === '' ? '' : Number(fila.sla_horas);
}

function actualizarEstado(db, data, contexto, opciones) {
  const opts = opciones || {};
  // P6: Gerencia ve todo, no toca nada.
  if (contexto.rol === 'GERENCIA' && !opts.sistemaAutomatico) {
    return errorForbidden('El rol Gerencia es de solo lectura: no puede cambiar estados.');
  }
  const subsolicitud = buscarSubsolicitud_(db, data.subsolicitud_id);
  if (!subsolicitud) {
    return errorValidacion('subsolicitud_id', 'Subsolicitud no encontrada: ' + data.subsolicitud_id);
  }
  if (!opts.sistemaAutomatico) {
    const veto = fueraDeSuPropioTrabajo_(contexto, subsolicitud, 'cambiar el estado');
    if (veto) return veto;
  }

  const estadoActual = subsolicitud.estado;
  if (!ESTADOS.hasOwnProperty(data.estado_nuevo)) {
    return errorValidacion('estado_nuevo', 'Estado invalido: ' + data.estado_nuevo);
  }
  if (data.estado_nuevo === estadoActual) {
    return errorValidacion('estado_nuevo', 'La subsolicitud ya esta en ese estado.');
  }
  // RN-201: "Cerrada" (S09) no es un destino libre para el gestor -- lo fija
  // el solicitante (Intake.validarCierre, no portado) salvo consulta tecnica.
  if (data.estado_nuevo === ESTADOS.S09 && !opts.sistemaAutomatico && !esConsultaTecnica_(subsolicitud)) {
    return errorForbidden(
      'Solo el solicitante puede confirmar el cierre (o el cierre automatico por inactividad). Mueve el item a Terminada para que quede listo para su validacion.'
    );
  }
  const comentario = data.comentario || '';
  if (comentarioObligatorioParaCambio_(estadoActual, data.estado_nuevo) && comentario.trim() === '') {
    return errorValidacion('comentario', 'Esta transicion exige un comentario con el motivo.');
  }

  const hermanas = obtenerSubsolicitudesDeSolicitud_(db, subsolicitud.solicitud_id);
  // RN-015: no se pasa a S04 con subsolicitudes sin titulo/descripcion.
  if (data.estado_nuevo === ESTADOS.S04) {
    const incompleta = hermanas.find((s) => !s.titulo || !s.descripcion);
    if (incompleta) {
      return errorValidacion('subsolicitudes', 'No se puede aprobar (S04): hay subsolicitudes sin titulo o descripcion (RN-015).');
    }
  }

  const timestamp = new Date().toISOString();
  const cambiosSubsolicitud = { estado: data.estado_nuevo };
  // v2.1 ("dos relojes"): entrar a Terminada (S08) detiene el reloj del
  // desarrollador; salir de Terminada lo reanuda.
  if (data.estado_nuevo === ESTADOS.S08) {
    cambiosSubsolicitud.fecha_terminada = timestamp;
  } else if (estadoActual === ESTADOS.S08) {
    cambiosSubsolicitud.fecha_terminada = '';
  }
  actualizarFilaPorId_(db, 'SUBSOLICITUDES', 'subsolicitud_id', data.subsolicitud_id, cambiosSubsolicitud);

  agregarFila_(db, 'HISTORIAL_ESTADOS', {
    historial_id: crypto.randomUUID(), solicitud_id: subsolicitud.solicitud_id,
    subsolicitud_id: data.subsolicitud_id, estado_anterior: estadoActual, estado_nuevo: data.estado_nuevo,
    usuario: contexto.email, comentario: comentario, timestamp: timestamp
  });

  const estadosActualizados = hermanas.map((s) => (s.subsolicitud_id === data.subsolicitud_id ? data.estado_nuevo : s.estado));
  const estadoDerivado = calcularEstadoDerivado_(estadosActualizados);
  actualizarFilaPorId_(db, 'SOLICITUDES', 'solicitud_id', subsolicitud.solicitud_id, { estado_derivado: estadoDerivado });

  Notificaciones.notificarCambioEstado(db, subsolicitud.solicitud_id, data.subsolicitud_id, estadoActual, data.estado_nuevo);

  return {
    subsolicitud_id: data.subsolicitud_id, solicitud_id: subsolicitud.solicitud_id,
    estado_anterior: estadoActual, estado_nuevo: data.estado_nuevo, estado_derivado_padre: estadoDerivado
  };
}

function asignarResponsables_(db, data, contexto) {
  if (!data.solicitud_id) return errorValidacion('solicitud_id', 'Falta indicar la solicitud.');
  if (!buscarSolicitudPorId_(db, data.solicitud_id)) return errorValidacion('solicitud_id', 'No existe una solicitud con ese numero.');

  // §13.3: si viene subsolicitud_id, el desarrollador se asigna a ESE item.
  if (data.desarrollador_asignado !== undefined && data.subsolicitud_id !== undefined) {
    if (!buscarSubsolicitud_(db, data.subsolicitud_id)) {
      return errorValidacion('subsolicitud_id', 'Subsolicitud no encontrada: ' + data.subsolicitud_id);
    }
    actualizarFilaPorId_(db, 'SUBSOLICITUDES', 'subsolicitud_id', data.subsolicitud_id, { desarrollador_asignado: data.desarrollador_asignado });
    return { solicitud_id: data.solicitud_id, subsolicitud_id: data.subsolicitud_id, desarrollador_asignado: data.desarrollador_asignado };
  }

  const cambios = {};
  if (data.desarrollador_asignado !== undefined) cambios.desarrollador_asignado = data.desarrollador_asignado;
  if (data.analista_asignado !== undefined) {
    if (contexto.rol !== 'ADM') return errorForbidden('Solo Admin puede reasignar el Analista responsable.');
    cambios.analista_asignado = data.analista_asignado;
  }
  actualizarFilaPorId_(db, 'SOLICITUDES', 'solicitud_id', data.solicitud_id, cambios);
  return Object.assign({ solicitud_id: data.solicitud_id }, cambios);
}

function actualizarPrioridad(db, data, contexto) {
  if (contexto.rol !== 'ANA' && contexto.rol !== 'ADM') {
    // RN-008: el Desarrollador no modifica prioridad (ni asigna responsables).
    return errorForbidden('El rol ' + contexto.rol + ' no puede modificar la prioridad.');
  }

  if (data.orden_atencion !== undefined) {
    // RN-009: el orden de atencion entre P1 simultaneos lo fija el Admin.
    if (contexto.rol !== 'ADM') return errorForbidden('Solo Admin puede fijar orden_atencion (RN-009).');
    actualizarFilaPorId_(db, 'SOLICITUDES', 'solicitud_id', data.solicitud_id, { orden_atencion: data.orden_atencion });
    return { solicitud_id: data.solicitud_id, orden_atencion: data.orden_atencion };
  }

  if (data.desarrollador_asignado !== undefined || data.analista_asignado !== undefined) {
    return asignarResponsables_(db, data, contexto);
  }

  if (ORDEN_PRIORIDAD.indexOf(data.prioridad_nueva) === -1) {
    return errorValidacion('prioridad_nueva', 'Prioridad invalida: ' + data.prioridad_nueva);
  }
  if (!data.justificacion || data.justificacion.trim().length < 20) {
    return errorValidacion('justificacion', 'La justificacion debe tener al menos 20 caracteres.');
  }

  const subsolicitud = buscarSubsolicitud_(db, data.subsolicitud_id);
  if (!subsolicitud) return errorValidacion('subsolicitud_id', 'Subsolicitud no encontrada: ' + data.subsolicitud_id);

  const prioridadAnterior = subsolicitud.prioridad;
  const slaHoras = obtenerSlaHoras_(db, data.prioridad_nueva);
  const timestamp = new Date().toISOString();

  actualizarFilaPorId_(db, 'SUBSOLICITUDES', 'subsolicitud_id', data.subsolicitud_id, { prioridad: data.prioridad_nueva, sla_objetivo_horas: slaHoras });

  agregarFila_(db, 'HISTORIAL_PRIORIDAD', {
    historial_id: crypto.randomUUID(), subsolicitud_id: data.subsolicitud_id, solicitud_id: subsolicitud.solicitud_id,
    prioridad_anterior: prioridadAnterior, prioridad_nueva: data.prioridad_nueva,
    justificacion: data.justificacion, usuario: contexto.email, timestamp: timestamp
  });

  const prioridadDerivada = recalcularPrioridadDerivada_(db, subsolicitud.solicitud_id);

  return {
    subsolicitud_id: data.subsolicitud_id, solicitud_id: subsolicitud.solicitud_id,
    prioridad_anterior: prioridadAnterior, prioridad_nueva: data.prioridad_nueva, prioridad_derivada_padre: prioridadDerivada
  };
}

function comprometerFecha(db, data, contexto) {
  if (contexto.rol === 'GERENCIA') {
    return errorForbidden('El rol Gerencia es de solo lectura: no puede comprometer fechas.');
  }
  if (!data.subsolicitud_id) return errorValidacion('subsolicitud_id', 'Falta indicar el item.');
  if (!data.fecha_comprometida || isNaN(new Date(data.fecha_comprometida).getTime())) {
    return errorValidacion('fecha_comprometida', 'Indica una fecha (y hora) valida para comprometerte.');
  }

  const subsolicitud = buscarSubsolicitud_(db, data.subsolicitud_id);
  if (!subsolicitud) return errorValidacion('subsolicitud_id', 'Subsolicitud no encontrada: ' + data.subsolicitud_id);

  const veto = fueraDeSuPropioTrabajo_(contexto, subsolicitud, 'comprometer fechas');
  if (veto) return veto;

  const esReCompromiso = !!subsolicitud.fecha_comprometida;
  if (esReCompromiso && (!data.motivo || data.motivo.trim().length < 20)) {
    return errorValidacion('motivo', 'Para mover una fecha ya comprometida debes indicar el motivo (minimo 20 caracteres).');
  }

  const timestamp = new Date().toISOString();
  actualizarFilaPorId_(db, 'SUBSOLICITUDES', 'subsolicitud_id', data.subsolicitud_id, {
    fecha_comprometida: data.fecha_comprometida, comprometida_por: contexto.email
  });

  if (esReCompromiso) {
    agregarFila_(db, 'HISTORIAL_COMPROMISO', {
      historial_id: crypto.randomUUID(), subsolicitud_id: data.subsolicitud_id, solicitud_id: subsolicitud.solicitud_id,
      fecha_anterior: subsolicitud.fecha_comprometida, fecha_nueva: data.fecha_comprometida,
      motivo: data.motivo, usuario: contexto.email, timestamp: timestamp
    });
  }

  // v2.1 (Fase D): avisa al solicitante -- "maneja expectativas, sin pedir su aprobacion".
  const solicitudParaAviso = buscarSolicitudPorId_(db, subsolicitud.solicitud_id);
  if (solicitudParaAviso) {
    Notificaciones.avisarCompromisoFecha(db, solicitudParaAviso, Object.assign({}, subsolicitud, { fecha_comprometida: data.fecha_comprometida }), data.fecha_comprometida);
  }

  return {
    subsolicitud_id: data.subsolicitud_id, solicitud_id: subsolicitud.solicitud_id,
    fecha_comprometida: data.fecha_comprometida, comprometida_por: contexto.email, re_compromiso: esReCompromiso
  };
}

function responsableDeItem_(item, solicitud) {
  return item.desarrollador_asignado || solicitud.desarrollador_asignado || '';
}

// Pasada 1 de 2: resuelve y valida UNA derivacion sin escribir nada.
function planificarDerivacion_(db, solicitudId, subsolicitudId, contexto) {
  const solicitud = buscarSolicitudPorId_(db, solicitudId);
  if (!solicitud) return errorValidacion('solicitud_id', 'No existe una solicitud con ese numero: ' + solicitudId);

  const esItemPuntual = subsolicitudId !== undefined && subsolicitudId !== '';
  let items = obtenerSubsolicitudesDeSolicitud_(db, solicitudId);
  if (esItemPuntual) {
    items = items.filter((s) => s.subsolicitud_id === subsolicitudId);
    if (!items.length) return errorValidacion('subsolicitud_id', 'Subsolicitud no encontrada: ' + subsolicitudId);
  }

  // §2.4: un Desarrollador solo puede traspasar SU trabajo.
  if (contexto.rol === 'DEV') {
    const ajeno = items.filter((s) => responsableDeItem_(s, solicitud) !== contexto.email);
    if (ajeno.length) return errorForbidden('Solo puedes derivar solicitudes asignadas a ti (' + solicitudId + ').');
  }

  return {
    solicitud: solicitud, solicitudId: solicitudId, subsolicitudId: esItemPuntual ? subsolicitudId : '', items: items,
    anterior: esItemPuntual ? responsableDeItem_(items[0], solicitud) : (solicitud.desarrollador_asignado || '')
  };
}

// Pasada 2 de 2: escribe. Solo se llama con planes ya validados.
function aplicarDerivacion_(db, plan, responsableNuevo, motivo, contexto, timestamp) {
  const { solicitudId, subsolicitudId, items, anterior } = plan;

  items.forEach((item) => {
    actualizarFilaPorId_(db, 'SUBSOLICITUDES', 'subsolicitud_id', item.subsolicitud_id, { desarrollador_asignado: responsableNuevo });
  });
  // Al derivar la solicitud COMPLETA se mueve tambien el responsable "por
  // defecto" de la cabecera; al derivar un item suelto, no.
  if (!subsolicitudId) {
    actualizarFilaPorId_(db, 'SOLICITUDES', 'solicitud_id', solicitudId, { desarrollador_asignado: responsableNuevo });
  }

  agregarFila_(db, 'HISTORIAL_ASIGNACION', {
    historial_id: crypto.randomUUID(), solicitud_id: solicitudId, subsolicitud_id: subsolicitudId || '',
    responsable_anterior: anterior, responsable_nuevo: responsableNuevo, motivo: motivo,
    usuario: contexto.email, timestamp: timestamp
  });

  return {
    solicitud_id: solicitudId, subsolicitud_id: subsolicitudId || '', responsable_anterior: anterior,
    responsable_nuevo: responsableNuevo, solicitud: plan.solicitud, items: items.map((s) => s.subsolicitud_id)
  };
}

function derivarSolicitud(db, data, contexto) {
  if (contexto.rol === 'GERENCIA') return errorForbidden('Gerencia tiene acceso de solo lectura.');
  if (!data.responsable_nuevo) return errorValidacion('responsable_nuevo', 'Indica a quien se deriva.');

  const motivo = String(data.motivo || '').trim();
  if (motivo.length < 10) return errorValidacion('motivo', 'El motivo debe tener al menos 10 caracteres.');

  const ids = data.solicitud_ids !== undefined ? data.solicitud_ids : (data.solicitud_id ? [data.solicitud_id] : []);
  if (!ids.length) return errorValidacion('solicitud_id', 'Falta indicar la solicitud.');
  // El lote deriva solicitudes completas, no items sueltos.
  if (data.solicitud_ids !== undefined && data.subsolicitud_id !== undefined) {
    return errorValidacion('subsolicitud_id', 'La derivacion en lote es por solicitud completa, no por item.');
  }

  // Dos pasadas: no se escribe nada hasta que TODAS pasan la validacion (un
  // id malo a mitad de un lote de 40 no debe dejar 20 ya movidas).
  const planes = [];
  for (const id of ids) {
    const plan = planificarDerivacion_(db, id, data.subsolicitud_id, contexto);
    if (plan._validationError || plan._forbidden) return plan;
    planes.push(plan);
  }

  const timestamp = new Date().toISOString();
  const derivadas = planes.map((plan) => aplicarDerivacion_(db, plan, data.responsable_nuevo, motivo, contexto, timestamp));

  // El aviso va agrupado: derivar 40 solicitudes no debe producir 40 correos.
  Notificaciones.notificarDerivacion(db, derivadas, data.responsable_nuevo, motivo, contexto.email);

  return {
    responsable_nuevo: data.responsable_nuevo, motivo: motivo,
    derivadas: derivadas.map((d) => d.solicitud_id), total: derivadas.length
  };
}

function editarContenidoSubsolicitud(db, data, contexto) {
  const rol = contexto ? contexto.rol : '';
  if (rol === 'GERENCIA' || rol === 'JEFATURA') {
    return errorForbidden('El rol ' + rol + ' es de solo lectura: no puede editar el contenido.');
  }
  if (!data || !data.subsolicitud_id) return errorValidacion('subsolicitud_id', 'Falta la subsolicitud a editar.');
  const sub = buscarSubsolicitud_(db, data.subsolicitud_id);
  if (!sub) return errorValidacion('subsolicitud_id', 'Subsolicitud no encontrada: ' + data.subsolicitud_id);

  const veto = fueraDeSuPropioTrabajo_(contexto, sub, 'editar el contenido');
  if (veto) return veto;

  const titulo = String(data.titulo || '').trim();
  const descripcion = String(data.descripcion || '').trim();
  if (titulo.length < 3) return errorValidacion('titulo', 'El titulo es muy corto.');
  if (descripcion.length < 5) return errorValidacion('descripcion', 'La descripcion es muy corta.');
  const contextoTxt = String(data.contexto || '').trim();
  const resultado = String(data.resultado_esperado || '').trim();

  const cambios = [];
  if (titulo !== String(sub.titulo || '')) cambios.push('Título: "' + String(sub.titulo || '') + '" → "' + titulo + '"');
  if (descripcion !== String(sub.descripcion || '')) cambios.push('Descripción actualizada');
  if (contextoTxt !== String(sub.contexto || '')) cambios.push('Contexto actualizado');
  if (resultado !== String(sub.resultado_esperado || '')) cambios.push('Resultado esperado actualizado');
  if (!cambios.length) return { ok: true, cambios: 0 };

  actualizarFilaPorId_(db, 'SUBSOLICITUDES', 'subsolicitud_id', data.subsolicitud_id, {
    titulo: titulo, descripcion: descripcion, contexto: contextoTxt, resultado_esperado: resultado
  });

  try {
    agregarFila_(db, 'COMENTARIOS', {
      comentario_id: crypto.randomUUID(), solicitud_id: sub.solicitud_id, subsolicitud_id: data.subsolicitud_id,
      usuario: (contexto && contexto.email) || '', texto: 'Corrigió el contenido del ítem. ' + cambios.join('. ') + '.',
      es_interno: true, timestamp: new Date().toISOString()
    });
  } catch (errTraza_) { /* la correccion ya quedo guardada */ }

  return { ok: true, cambios: cambios.length };
}

// Personas que pueden tener una bandeja propia (Gestor/Analista o Gestor
// tecnico, activos) -- destino posible del selector "Derivar". Portado
// desde Dashboard.gs (obtenerResponsablesActivos_, no portado entero
// todavia) porque getDetalle es el unico que lo necesita por ahora.
function obtenerResponsablesActivos_(db) {
  let filas;
  try { filas = leerFilas_(db, 'USUARIOS', COLUMNAS.USUARIOS); } catch (err) { return []; }
  return filas.filter((u) => {
    const activo = u.activo === true || u.activo === 'TRUE' || u.activo === 1;
    return activo && (u.rol === 'DEV' || u.rol === 'ANA');
  });
}

// v6.0 (fix de horas) en el .gs original: Sheets coacciona una celda de
// fecha-hora a Date al leerla con getValues(), y serializarla a JSON sacaba
// la hora en UTC (corrida). fechaHoraCelda_ recuperaba el "AAAA-MM-DDTHH:mm"
// LOCAL para ese caso.
//
// En este puerto el bug de origen NO EXISTE: sqliteRepo_ nunca coacciona
// nada -- guarda y devuelve exactamente el string que se le paso. Si algo
// escribe un objeto Date real (no deberia pasar: todo el codigo de este
// proyecto siempre pasa ISO strings), ya sale mal ANTES de llegar aqui --
// agregarFila_/actualizarFilaPorId_ lo serializan con JSON.stringify(Date),
// que usa toISOString() (UTC), en el momento de ESCRIBIR, no de leer. Esta
// funcion se mantiene solo por fidelidad con el .gs y como defensa barata
// si algun dia llega un string ya en otro formato; no repara el caso Date
// (ese hay que evitarlo en el origen: no pasar objetos Date a agregarFila_).
function fechaHoraCelda_(valor) {
  if (valor === null || valor === undefined || valor === '') return '';
  if (Object.prototype.toString.call(valor) === '[object Date]') {
    if (isNaN(valor.getTime())) return '';
    const d2 = (n) => (n < 10 ? '0' + n : '' + n);
    return valor.getFullYear() + '-' + d2(valor.getMonth() + 1) + '-' + d2(valor.getDate()) +
      'T' + d2(valor.getHours()) + ':' + d2(valor.getMinutes());
  }
  return String(valor);
}

/**
 * Detalle completo de una solicitud (RF-018). El JEFATURA solo puede abrir
 * el detalle de una solicitud de SU equipo (v4.2) -- sin este guardia,
 * pediria cualquier solicitud_id y la veria igual.
 */
function getDetalle(db, solicitudId, contexto) {
  if (!solicitudId) return errorValidacion('solicitud_id', 'Falta indicar el numero de solicitud.');
  const solicitud = buscarSolicitudPorId_(db, solicitudId);
  if (!solicitud) return errorValidacion('solicitud_id', 'No existe una solicitud con ese numero.');

  if (contexto && contexto.rol === 'JEFATURA') {
    const equipoJefe = Jefatura.obtenerEquipoJefe_(db, contexto.email);
    const equipoJefeSet = {};
    equipoJefe.forEach((email) => { equipoJefeSet[email] = true; });
    const subsolicitudesParaGuardia = obtenerSubsolicitudesDeSolicitud_(db, solicitudId);
    if (!Jefatura.esDelEquipoJefaturaSolicitud_(solicitud, subsolicitudesParaGuardia, equipoJefeSet)) {
      return errorForbidden('Esa solicitud no pertenece a tu equipo.');
    }
  }

  // El semaforo de cumplimiento (v2.1 §6) se calcula aqui, no se guarda.
  let feriadosDetalle = [];
  try { feriadosDetalle = Cumplimiento.obtenerFeriados(db); } catch (err) { /* sin CONFIG_FERIADOS se mide sin excluir feriados */ }

  const subsolicitudes = obtenerSubsolicitudesDeSolicitud_(db, solicitudId).map((sub) => {
    const medicionSla = Cumplimiento.medir(sub, { feriados: feriadosDetalle });
    const copia = Object.assign({}, sub, {
      cumplimiento: Cumplimiento.clasificar(sub),
      situacion_sla: medicionSla ? medicionSla.situacion : null,
      sla_restante_horas: medicionSla ? Math.round(medicionSla.restantes_horas * 10) / 10 : null
    });
    copia.fecha_comprometida = fechaHoraCelda_(sub.fecha_comprometida);
    copia.fecha_propuesta = fechaHoraCelda_(sub.fecha_propuesta);
    return copia;
  });

  // Fase 10.1: cualquier estado es un destino valido -- el selector ofrece
  // los 11 estados menos el actual, marcando cuales piden comentario.
  const rolActual = contexto ? contexto.rol : '';
  const esSoloLectura = rolActual === 'GERENCIA' || rolActual === 'JEFATURA';
  const transicionesPorSubsolicitud = {};
  subsolicitudes.forEach((sub) => {
    transicionesPorSubsolicitud[sub.subsolicitud_id] = esSoloLectura ? [] : Object.keys(ESTADOS)
      // RN-201: "Cerrada" no se ofrece al gestor salvo consulta tecnica.
      .filter((estado) => {
        if (estado === sub.estado) return false;
        if (estado === ESTADOS.S09 && !esConsultaTecnica_(sub)) return false;
        return true;
      })
      .map((estado) => ({ estado: estado, comentario_obligatorio: comentarioObligatorioParaCambio_(sub.estado, estado) }));
  });

  const historialEstados = leerFilas_(db, 'HISTORIAL_ESTADOS', COLUMNAS.HISTORIAL_ESTADOS)
    .filter((h) => h.solicitud_id === solicitudId)
    .sort((a, b) => new Date(a.timestamp) - new Date(b.timestamp));
  const historialPrioridad = leerFilas_(db, 'HISTORIAL_PRIORIDAD', COLUMNAS.HISTORIAL_PRIORIDAD)
    .filter((h) => h.solicitud_id === solicitudId)
    .sort((a, b) => new Date(a.timestamp) - new Date(b.timestamp));
  const historialCompromiso = leerFilas_(db, 'HISTORIAL_COMPROMISO', COLUMNAS.HISTORIAL_COMPROMISO)
    .filter((h) => h.solicitud_id === solicitudId)
    .sort((a, b) => new Date(a.timestamp) - new Date(b.timestamp));
  let historialAsignacion = [];
  try {
    historialAsignacion = leerFilas_(db, 'HISTORIAL_ASIGNACION', COLUMNAS.HISTORIAL_ASIGNACION)
      .filter((h) => h.solicitud_id === solicitudId)
      .sort((a, b) => new Date(a.timestamp) - new Date(b.timestamp));
  } catch (err) { historialAsignacion = []; }
  const comentarios = leerFilas_(db, 'COMENTARIOS', COLUMNAS.COMENTARIOS)
    .filter((c) => c.solicitud_id === solicitudId)
    .sort((a, b) => new Date(a.timestamp) - new Date(b.timestamp));
  const archivos = leerFilas_(db, 'ARCHIVOS', COLUMNAS.ARCHIVOS)
    .filter((a) => a.solicitud_id === solicitudId)
    .sort((a, b) => new Date(a.fecha_subida) - new Date(b.fecha_subida));

  return {
    solicitud: solicitud, subsolicitudes: subsolicitudes, historial_estados: historialEstados,
    historial_prioridad: historialPrioridad, historial_compromiso: historialCompromiso,
    historial_asignacion: historialAsignacion, comentarios: comentarios, archivos: archivos,
    rol_actual: rolActual,
    responsables: esSoloLectura ? [] : obtenerResponsablesActivos_(db),
    transiciones_por_subsolicitud: transicionesPorSubsolicitud
  };
}

module.exports = {
  actualizarEstado, actualizarPrioridad, comprometerFecha, derivarSolicitud,
  editarContenidoSubsolicitud, getDetalle,
  recalcularEstadoDerivado_, calcularEstadoDerivado_
};
